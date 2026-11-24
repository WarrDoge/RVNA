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
	const groupRows = await db
		.select({ id: groups.id, name: groups.name, local: groups.local })
		.from(groups);
	const groupIds = new Map(
		groupRows.map((row) => [row.name.toLowerCase(), row.id]),
	);
	// An administrator owns a local group; a Confluence group of the same name must not join it.
	const localGroupIds = new Map(
		groupRows
			.filter((row) => row.local)
			.map((row) => [row.name.toLowerCase(), row.id]),
	);
	if (localGroupIds.size > 0) {
		await db
			.delete(userGroups)
			.where(
				and(
					eq(userGroups.source, SOURCE),
					inArray(userGroups.groupId, [...localGroupIds.values()]),
				),
			);
	}

	const result = {
		referenced: wanted.size,
		missingInConfluence: 0,
		localGroups: 0,
		memberships: 0,
		removed: 0,
		membersWithoutUser: 0,
	};
	const desiredByGroup = new Map<string, Set<string>>();

	for (const [lower, name] of wanted) {
		if (localGroupIds.has(lower)) {
			result.localGroups++;
			continue;
		}
		const remoteName = remoteNames.get(lower);
		if (!remoteName) {
			result.missingInConfluence++;
			const groupId = groupIds.get(lower);
			if (groupId) {
				const removed = await db
					.delete(userGroups)
					.where(
						and(eq(userGroups.groupId, groupId), eq(userGroups.source, SOURCE)),
					)
					.returning({ userId: userGroups.userId });
				result.removed += removed.length;
			}
			continue;
		}

		let members: { username?: string }[];
		try {
			members = await allPages<{ username?: string }>(
				client,
				`/rest/api/group/${encodeURIComponent(remoteName)}/member`,
			);
		} catch {
			result.missingInConfluence++;
			continue;
		}

		let groupId = groupIds.get(lower);
		if (!groupId) {
			const [inserted] = await db
				.insert(groups)
				.values({ name })
				.onConflictDoNothing()
				.returning({ id: groups.id });
			groupId = inserted?.id;
			if (!groupId) {
				const [existing] = await db
					.select({ id: groups.id })
					.from(groups)
					.where(sql`lower(${groups.name}) = ${lower}`)
					.limit(1);
				groupId = existing?.id;
			}
			if (!groupId) continue;
			groupIds.set(lower, groupId);
		}

		const desired = new Set<string>();
		for (const member of members) {
			const id = userIds.get((member.username ?? "").toLowerCase());
			if (id) desired.add(id);
			else result.membersWithoutUser++;
		}
		desiredByGroup.set(groupId, desired);
	}

	const wantedGroupIds = [...desiredByGroup.keys()];
	const existingByGroup = new Map<string, Set<string>>();
	if (wantedGroupIds.length > 0) {
		const existing = await db
			.select({ groupId: userGroups.groupId, userId: userGroups.userId })
			.from(userGroups)
			.where(
				and(
					inArray(userGroups.groupId, wantedGroupIds),
					eq(userGroups.source, SOURCE),
				),
			);
		for (const row of existing) {
			const set = existingByGroup.get(row.groupId) ?? new Set<string>();
			set.add(row.userId);
			existingByGroup.set(row.groupId, set);
		}
	}

	const inserts: { userId: string; groupId: string; source: string }[] = [];
	for (const [groupId, desired] of desiredByGroup) {
		const existing = existingByGroup.get(groupId) ?? new Set<string>();
		for (const userId of desired) {
			if (!existing.has(userId)) {
				inserts.push({ userId, groupId, source: SOURCE });
			}
		}
	}
	if (inserts.length > 0) {
		await db.insert(userGroups).values(inserts).onConflictDoNothing();
		result.memberships += inserts.length;
	}

	for (const [groupId, desired] of desiredByGroup) {
		const existing = existingByGroup.get(groupId) ?? new Set<string>();
		const stale = [...existing].filter((id) => !desired.has(id));
		if (stale.length > 0) {
			await db
				.delete(userGroups)
				.where(
					and(
						eq(userGroups.groupId, groupId),
						eq(userGroups.source, SOURCE),
						inArray(userGroups.userId, stale),
					),
				);
			result.removed += stale.length;
		}
	}
	return result;
}
