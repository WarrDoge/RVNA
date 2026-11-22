import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import { userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { requireAdminActor } from "../permissions.ts";
import { groups, userGroups, users } from "../schema.ts";
import { audit } from "./audit.ts";

export const groupSummarySchema = z.object({
	id: z.uuid(),
	name: z.string(),
	local: z.boolean(),
	memberCount: z.number().int(),
});

export const groupMemberSchema = z.object({
	id: z.uuid(),
	username: z.string(),
	displayName: z.string(),
	email: z.string().nullable(),
	avatarUrl: z.string().nullable(),
	active: z.boolean(),
	sources: z.array(z.string()),
});

export const groupDetailSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	local: z.boolean(),
	members: z.array(groupMemberSchema),
});

export const groupParams = z.object({ id: z.uuid() });
export const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });

export const groupListQuery = z.object({
	query: z.string().trim().max(200).default(""),
	name: z.string().trim().max(255).optional(),
});

export const groupCreateBody = z.object({
	name: z.string().trim().min(1).max(255),
});

export const groupMemberBody = z.object({ userId: z.uuid() });

export const groupDetailResponseSchema = z.object({
	group: groupDetailSchema,
});

const followsSourceMessage =
	"This membership comes from the identity provider or an import and follows its source; only memberships added here can be removed here";

async function loadGroup(id: string) {
	const [row] = await db
		.select({ id: groups.id, name: groups.name, local: groups.local })
		.from(groups)
		.where(eq(groups.id, id))
		.limit(1);
	return row ?? null;
}

async function groupDetail(id: string) {
	const group = await loadGroup(id);
	if (!group) return null;
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			email: users.email,
			avatarUrl: userAvatarSql(users.id),
			active: users.active,
			source: userGroups.source,
		})
		.from(userGroups)
		.innerJoin(users, eq(users.id, userGroups.userId))
		.where(eq(userGroups.groupId, group.id))
		.orderBy(sql`lower(${users.displayName})`, users.username);
	const members: (Omit<(typeof rows)[number], "source"> & {
		sources: string[];
	})[] = [];
	const byId = new Map<string, (typeof members)[number]>();
	for (const { source, ...member } of rows) {
		const existing = byId.get(member.id);
		if (existing) {
			existing.sources.push(source);
			continue;
		}
		const added = { ...member, sources: [source] };
		members.push(added);
		byId.set(added.id, added);
	}
	return { ...group, members };
}

function isUniqueViolation(error: unknown) {
	for (
		let cause = error as { code?: unknown; cause?: unknown } | undefined;
		cause;
	) {
		if (cause.code === "23505") return true;
		cause = cause.cause as typeof cause;
	}
	return false;
}

export async function listGroups(
	actor: CurrentUser,
	query: z.infer<typeof groupListQuery>,
) {
	requireAdminActor(actor);
	const { query: search, name } = query;
	const filters = [
		search === ""
			? undefined
			: sql`${groups.name} ilike ${`%${search.replace(/[\\%_]/g, "\\$&")}%`}`,
		name === undefined
			? undefined
			: sql`lower(${groups.name}) = lower(${name})`,
	].filter((filter) => filter !== undefined);

	const rows = await db
		.select({
			id: groups.id,
			name: groups.name,
			local: groups.local,
			memberCount: sql<number>`(
				select count(distinct ug.user_id)::int from user_groups ug where ug.group_id = groups.id
			)`,
		})
		.from(groups)
		.where(filters.length > 0 ? and(...filters) : undefined)
		.orderBy(sql`lower(${groups.name})`);
	return rows;
}

export async function getGroup(actor: CurrentUser, id: string) {
	requireAdminActor(actor);
	const group = await groupDetail(id);
	if (!group) throw new HttpError(404, "Group not found");
	return group;
}

export async function createGroup(
	actor: CurrentUser,
	body: z.infer<typeof groupCreateBody>,
) {
	requireAdminActor(actor);
	const name = body.name;
	try {
		const created = await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext(lower(${name}))::bigint)`,
			);
			const [existing] = await tx
				.select({ id: groups.id })
				.from(groups)
				.where(sql`lower(${groups.name}) = lower(${name})`)
				.limit(1);
			if (existing) return null;

			const [row] = await tx
				.insert(groups)
				.values({ name, local: true })
				.returning({ id: groups.id });
			await audit(tx, actor, {
				action: "group.create",
				entityType: "group",
				entityId: row.id,
				summary: `Created group ${name}`,
				changes: { from: null, to: { name, local: true } },
			});
			return row.id;
		});

		if (!created) {
			throw new HttpError(409, "A group with this name already exists");
		}
		const group = await groupDetail(created);
		if (!group) throw new Error("Created group disappeared");
		return { group };
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new HttpError(409, "A group with this name already exists");
		}
		throw error;
	}
}

export async function deleteGroup(actor: CurrentUser, id: string) {
	requireAdminActor(actor);
	const group = await loadGroup(id);
	if (!group) throw new HttpError(404, "Group not found");
	if (!group.local) {
		throw new HttpError(
			409,
			`The group ${group.name} comes from the identity provider or an import and cannot be deleted`,
		);
	}

	await db.transaction(async (tx) => {
		await tx.delete(groups).where(eq(groups.id, group.id));
		await audit(tx, actor, {
			action: "group.delete",
			entityType: "group",
			entityId: group.id,
			summary: `Deleted group ${group.name}`,
			changes: { from: { name: group.name, local: true }, to: null },
		});
	});
}

export async function addGroupMember(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof groupMemberBody>,
) {
	requireAdminActor(actor);
	const group = await loadGroup(id);
	if (!group) throw new HttpError(404, "Group not found");

	const [user] = await db
		.select({ id: users.id, username: users.username })
		.from(users)
		.where(eq(users.id, body.userId))
		.limit(1);
	if (!user) throw new HttpError(404, "User not found");

	await db.transaction(async (tx) => {
		const [added] = await tx
			.insert(userGroups)
			.values({ userId: user.id, groupId: group.id, source: "local" })
			.onConflictDoNothing()
			.returning({ userId: userGroups.userId });
		if (!added) return;

		await audit(tx, actor, {
			action: "group.member.add",
			entityType: "group",
			entityId: group.id,
			summary: `Added ${user.username} to group ${group.name}`,
			changes: {
				from: null,
				to: { group: group.name, user: user.username },
			},
		});
	});

	const updated = await groupDetail(group.id);
	if (!updated) throw new HttpError(404, "Group not found");
	return { group: updated };
}

export async function removeGroupMember(
	actor: CurrentUser,
	id: string,
	userId: string,
) {
	requireAdminActor(actor);
	const group = await loadGroup(id);
	if (!group) throw new HttpError(404, "Group not found");

	const memberships = await db
		.select({
			id: users.id,
			username: users.username,
			source: userGroups.source,
		})
		.from(userGroups)
		.innerJoin(users, eq(users.id, userGroups.userId))
		.where(
			and(eq(userGroups.groupId, group.id), eq(userGroups.userId, userId)),
		);
	const member = memberships[0];
	if (!member) {
		throw new HttpError(404, "That user is not a member of this group");
	}
	if (!memberships.some((row) => row.source === "local")) {
		throw new HttpError(409, followsSourceMessage);
	}
	const otherSources = memberships.some((row) => row.source !== "local");

	await db.transaction(async (tx) => {
		const [removed] = await tx
			.delete(userGroups)
			.where(
				and(
					eq(userGroups.groupId, group.id),
					eq(userGroups.userId, member.id),
					eq(userGroups.source, "local"),
				),
			)
			.returning({ source: userGroups.source });
		if (!removed) {
			throw new HttpError(404, "That user is not a member of this group");
		}
		await audit(tx, actor, {
			action: "group.member.remove",
			entityType: "group",
			entityId: group.id,
			summary: otherSources
				? `Removed the local membership of ${member.username} from group ${group.name}`
				: `Removed ${member.username} from group ${group.name}`,
			changes: {
				from: { group: group.name, user: member.username },
				to: null,
			},
		});
	});

	const updated = await groupDetail(group.id);
	if (!updated) throw new HttpError(404, "Group not found");
	return { group: updated };
}
