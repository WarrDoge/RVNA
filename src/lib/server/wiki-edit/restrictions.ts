import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type {
	PageRestrictions,
	RestrictionSubjects,
} from "../../shared/wiki/index.ts";
import { type CurrentUser, hasGroup } from "../auth.ts";
import { db } from "../db.ts";
import { users } from "../schema.ts";
import { pageRestrictions } from "../schema-wiki.ts";
import type { WikiAccess } from "../wiki/permissions.ts";
import { requireAccess } from "./access.ts";
import {
	assertCurrent,
	type Executor,
	fail,
	loadPage,
	loadUserRefs,
	newSourceId,
	type PageRow,
} from "./common.ts";
import { lockPage } from "./content.ts";
import { ancestors } from "./helpers.ts";

type Operation = "read" | "update";

async function subjectsByPage(ex: Executor, pageIds: string[]) {
	const result = new Map<string, Record<Operation, RestrictionSubjects>>();
	if (pageIds.length === 0) return result;
	const rows = await ex
		.select()
		.from(pageRestrictions)
		.where(inArray(pageRestrictions.pageId, pageIds));
	const refs = await loadUserRefs(
		ex,
		rows.map((row) => row.userId),
	);
	for (const row of rows) {
		const entry = result.get(row.pageId) ?? {
			read: { users: [], groups: [] },
			update: { users: [], groups: [] },
		};
		const subjects = entry[row.operation];
		const ref = row.userId ? refs.get(row.userId) : undefined;
		if (ref) subjects.users.push(ref);
		if (row.groupName) subjects.groups.push(row.groupName);
		result.set(row.pageId, entry);
	}
	return result;
}

export async function restrictionsOf(
	ex: Executor,
	page: PageRow,
): Promise<PageRestrictions> {
	const chain = await ancestors(ex, page.id);
	const byPage = await subjectsByPage(ex, [page.id, ...chain.map((a) => a.id)]);
	const empty = () => ({ users: [], groups: [] });
	const own = byPage.get(page.id);
	return {
		read: own?.read ?? empty(),
		update: own?.update ?? empty(),
		// Only view restrictions inherit; an ancestor's edit restriction has no effect here.
		inherited: chain.flatMap((ancestor) => {
			const entry = byPage.get(ancestor.id);
			const has =
				entry && entry.read.users.length + entry.read.groups.length > 0;
			return has
				? [
						{
							pageId: ancestor.id,
							title: ancestor.title,
							read: entry.read,
							update: empty(),
						},
					]
				: [];
		}),
	};
}

const subjectsInput = z.object({
	userIds: z.array(z.uuid()).max(500),
	groups: z.array(z.string().trim().min(1).max(255)).max(500),
});

export const restrictionsBody = z.object({
	read: subjectsInput,
	update: subjectsInput,
});

export const listed = (
	user: CurrentUser,
	input: z.infer<typeof subjectsInput>,
) =>
	input.userIds.includes(user.id) ||
	input.groups.some((group) => hasGroup(user, group));

/**
 * A user or group in a restriction must be one the caller may pick: an existing active user, or one
 * of the caller's own groups. Whoever administers the space may name any existing user and any
 * group. What the page already names stays usable, so an unchanged list can be saved. One text for
 * every failure, so the answer does not say whether a user or group exists.
 */
async function assertSubjectsUsable(
	actor: CurrentUser,
	pageId: string,
	unlimited: boolean,
	input: Record<Operation, z.infer<typeof subjectsInput>>,
) {
	const named = await db
		.select({
			userId: pageRestrictions.userId,
			groupName: pageRestrictions.groupName,
		})
		.from(pageRestrictions)
		.where(eq(pageRestrictions.pageId, pageId));
	const namedUsers = new Set(named.map((row) => row.userId));
	const namedGroups = new Set(named.map((row) => row.groupName?.toLowerCase()));

	const ids = [...new Set([...input.read.userIds, ...input.update.userIds])];
	const found = ids.length
		? await db
				.select({ id: users.id, active: users.active })
				.from(users)
				.where(inArray(users.id, ids))
		: [];
	const usable = new Map(found.map((row) => [row.id, row.active]));
	const usersOk = ids.every(
		(id) =>
			usable.has(id) && (unlimited || usable.get(id) || namedUsers.has(id)),
	);
	const groupsOk = [...input.read.groups, ...input.update.groups].every(
		(group) =>
			unlimited ||
			hasGroup(actor, group) ||
			namedGroups.has(group.toLowerCase()),
	);
	if (!usersOk || !groupsOk) {
		fail(400, "A user or group in the restrictions cannot be used");
	}
}

export async function listPageRestrictions(
	actor: CurrentUser,
	id: string,
	wiki?: WikiAccess,
) {
	const { page } = await loadPage(db, id);
	await requireAccess(actor, page, "read", wiki);
	return restrictionsOf(db, page);
}

export async function replacePageRestrictions(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof restrictionsBody>,
) {
	const { page } = await loadPage(db, id);
	const access = await requireAccess(actor, page, "restrict");
	assertCurrent(page);
	const input = {
		read: {
			userIds: [...new Set(body.read.userIds)],
			groups: [...new Set(body.read.groups)],
		},
		update: {
			userIds: [...new Set(body.update.userIds)],
			groups: [...new Set(body.update.groups)],
		},
	};

	await assertSubjectsUsable(actor, page.id, access.bypass, input);
	if (!access.bypass) {
		for (const operation of ["read", "update"] as const) {
			const subjects = input[operation];
			const any = subjects.userIds.length + subjects.groups.length > 0;
			if (any && !listed(actor, subjects)) {
				fail(
					400,
					`This change would remove your own ${operation} access to the page`,
				);
			}
		}
	}

	await db.transaction(async (tx) => {
		const fresh = await lockPage(tx, page.id);
		assertCurrent(fresh);
		await requireAccess(actor, fresh, "restrict", undefined, tx);
		await tx
			.delete(pageRestrictions)
			.where(eq(pageRestrictions.pageId, page.id));
		const rows = (["read", "update"] as const).flatMap((operation) => [
			...input[operation].userIds.map((userId) => ({
				sourceId: newSourceId(),
				pageId: page.id,
				operation,
				userId,
				groupName: null,
			})),
			...input[operation].groups.map((groupName) => ({
				sourceId: newSourceId(),
				pageId: page.id,
				operation,
				userId: null,
				groupName,
			})),
		]);
		if (rows.length > 0) await tx.insert(pageRestrictions).values(rows);
	});
	return restrictionsOf(db, page);
}
