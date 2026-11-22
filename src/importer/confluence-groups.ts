import { and, eq, inArray, sql } from "drizzle-orm";
import { groups, userGroups, users } from "../lib/server/schema.ts";
import { db } from "./db.ts";

export interface ConfluenceGroupClient {
	getJson<T>(
		path: string,
		params?: Record<string, string | number | boolean | undefined>,
	): Promise<T>;
}

interface Paged<T> {
	results: T[];
}

const PAGE_SIZE = 200;
const MAX_PAGES = 1000;
const SOURCE = "confluence";

async function allPages<T>(
	client: ConfluenceGroupClient,
	path: string,
): Promise<T[]> {
	const collected: T[] = [];
	let start = 0;
	for (let page = 0; page < MAX_PAGES; page++) {
		const response = await client.getJson<Paged<T>>(path, {
			start,
			limit: PAGE_SIZE,
		});
		const results = response.results ?? [];
		collected.push(...results);
		if (results.length === 0) return collected;
		start += results.length;
	}
	throw new Error(
		`pagination for ${path} did not finish after ${MAX_PAGES} pages`,
	);
}

/**
 * Confluence keeps its own directory, so a group of the same name can have
 * other members than in Jira. Only the groups that space permissions or page
 * restrictions name decide wiki access, so only those are fetched.
 */
export async function importConfluenceGroups(client: ConfluenceGroupClient) {
	const referenced = await db.execute<{ name: string }>(sql`
		select distinct group_name as name from space_permissions where group_name is not null
		union
		select distinct group_name from page_restrictions where group_name is not null
	`);
	const wanted = new Map(
		referenced.rows.map((row) => [row.name.toLowerCase(), row.name]),
	);
	const remote = await allPages<{ name: string }>(client, "/rest/api/group");
	const remoteNames = new Map(
		remote.map((group) => [group.name.toLowerCase(), group.name]),
	);

	const userRows = await db
		.select({ id: users.id, username: users.username })
		.from(users);
	const userIds = new Map(
		userRows.map((row) => [row.username.toLowerCase(), row.id]),
	);

	const result = {
		referenced: wanted.size,
		missingInConfluence: 0,
		memberships: 0,
		removed: 0,
		membersWithoutUser: 0,
	};

	for (const [lower, name] of wanted) {
		const remoteName = remoteNames.get(lower);
		if (!remoteName) {
			result.missingInConfluence++;
			continue;
		}
		const members = await allPages<{ username?: string }>(
			client,
			`/rest/api/group/${encodeURIComponent(remoteName)}/member`,
		);

		let [group] = await db
			.select({ id: groups.id })
			.from(groups)
			.where(sql`lower(${groups.name}) = ${lower}`)
			.limit(1);
		if (!group) {
			[group] = await db
				.insert(groups)
				.values({ name })
				.onConflictDoNothing()
				.returning({ id: groups.id });
		}
		if (!group) continue;

		const desired = new Set<string>();
		for (const member of members) {
			const id = userIds.get((member.username ?? "").toLowerCase());
			if (id) desired.add(id);
			else result.membersWithoutUser++;
		}

		const existing = await db
			.select({ userId: userGroups.userId })
			.from(userGroups)
			.where(
				and(eq(userGroups.groupId, group.id), eq(userGroups.source, SOURCE)),
			);
		const existingIds = new Set(existing.map((row) => row.userId));

		for (const userId of desired) {
			if (existingIds.has(userId)) continue;
			await db
				.insert(userGroups)
				.values({ userId, groupId: group.id, source: SOURCE })
				.onConflictDoNothing();
			result.memberships++;
		}
		const stale = [...existingIds].filter((id) => !desired.has(id));
		if (stale.length > 0) {
			await db
				.delete(userGroups)
				.where(
					and(
						eq(userGroups.groupId, group.id),
						eq(userGroups.source, SOURCE),
						inArray(userGroups.userId, stale),
					),
				);
			result.removed += stale.length;
		}
	}
	return result;
}
