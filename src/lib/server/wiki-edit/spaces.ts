import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
	docToStorage,
	emptyDoc,
	type SpacePermissionRow,
	type SpaceSummary,
	storageToDoc,
	type TemplateDetail,
} from "../../shared/wiki/index.ts";
import { type CurrentUser, hasGroup } from "../auth.ts";
import { db } from "../db.ts";
import { groups, users } from "../schema.ts";
import {
	pageAttachments,
	pages,
	pageTemplates,
	pageVersions,
	spacePermissions,
	spaces,
} from "../schema-wiki.ts";
import {
	can,
	requireGrant,
	requireReadableSpace,
	SPACE_PERMISSIONS,
	spaceGrants,
} from "./access.ts";
import {
	allow,
	docSchema,
	fail,
	loadSpace,
	loadUserRefs,
	newSourceId,
	pgCode,
	type SpaceRow,
	titleSchema,
} from "./common.ts";
import { checkDoc, renderBody } from "./content.ts";
import { removeOrphanFiles } from "./files.ts";

export const spaceSummary = (space: SpaceRow): SpaceSummary => ({
	id: space.id,
	key: space.key,
	name: space.name,
	type: space.type,
	status: space.status,
	descriptionHtml: space.descriptionHtml,
	homePageId: space.homePageId,
});

const escapeHtml = (text: string) =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

const descriptionHtml = (text: string | undefined) =>
	text === undefined || text.trim() === ""
		? null
		: `<p>${escapeHtml(text.trim())}</p>`;

const creatorPermissions = [
	"administer",
	"read",
	"create",
	"delete",
	"restrict",
	"export",
];

export const permissionsInput = z.object({
	permissions: z
		.array(
			z.object({
				permission: z.enum(SPACE_PERMISSIONS),
				userId: z.uuid().optional(),
				groupName: z.string().trim().min(1).max(255).optional(),
				anonymous: z.boolean().optional(),
			}),
		)
		.max(5000),
});

async function permissionRows(spaceId: string): Promise<SpacePermissionRow[]> {
	const rows = await db
		.select()
		.from(spacePermissions)
		.where(eq(spacePermissions.spaceId, spaceId));
	const refs = await loadUserRefs(
		db,
		rows.map((row) => row.userId),
	);
	const order = (permission: string) =>
		SPACE_PERMISSIONS.indexOf(permission as (typeof SPACE_PERMISSIONS)[number]);
	return rows
		.filter((row) => row.userId || row.groupName || row.anonymous)
		.map((row) => ({
			permission: row.permission,
			user: row.userId ? (refs.get(row.userId) ?? null) : null,
			groupName: row.groupName,
			anonymous: row.anonymous,
		}))
		.sort(
			(a, b) =>
				order(a.permission) - order(b.permission) ||
				(a.user?.displayName ?? a.groupName ?? "").localeCompare(
					b.user?.displayName ?? b.groupName ?? "",
				),
		);
}

async function templateDetail(
	row: typeof pageTemplates.$inferSelect,
	spaceKey: string | null,
): Promise<TemplateDetail> {
	return {
		id: row.id,
		spaceKey,
		name: row.name,
		description: row.description,
		bodyDoc: row.bodyStorage ? storageToDoc(row.bodyStorage) : emptyDoc(),
	};
}

export const templateBody = z.object({
	name: titleSchema,
	description: z.string().max(2000).optional(),
	bodyDoc: docSchema,
});

export const createSpaceBody = z.object({
	key: z.string().trim().min(1).max(255),
	name: titleSchema,
	description: z.string().max(10_000).optional(),
});

export const updateSpaceBody = z.object({
	name: titleSchema.optional(),
	description: z.string().max(10_000).optional(),
	homePageId: z.uuid().nullish(),
});

export async function createSpace(
	actor: CurrentUser,
	body: z.infer<typeof createSpaceBody>,
) {
	allow(actor.isAdmin, "Only an administrator can create a space");
	const key = body.key.toUpperCase();
	if (!/^[A-Z0-9]{2,255}$/.test(key)) {
		fail(400, "Space key must be 2 to 255 letters and digits");
	}
	const [taken] = await db
		.select({ id: spaces.id })
		.from(spaces)
		.where(sql`lower(${spaces.key}) = lower(${key})`)
		.limit(1);
	if (taken) fail(409, `Space key ${key} is already in use`);

	let space: SpaceRow;
	try {
		space = await db.transaction(async (tx) => {
			const now = new Date();
			const [created] = await tx
				.insert(spaces)
				.values({
					sourceId: newSourceId(),
					key,
					name: body.name,
					type: "global",
					descriptionHtml: descriptionHtml(body.description),
					ownerId: actor.id,
					creatorId: actor.id,
					created: now,
				})
				.returning();
			const rendered = await renderBody(tx, emptyDoc(), key, null);
			const [home] = await tx
				.insert(pages)
				.values({
					sourceId: newSourceId(),
					spaceId: created.id,
					title: body.name,
					versionNumber: 1,
					...rendered,
					creatorId: actor.id,
					created: now,
					lastModifierId: actor.id,
					updated: now,
				})
				.returning();
			await tx.insert(pageVersions).values({
				sourceId: newSourceId(),
				pageId: home.id,
				number: 1,
				title: home.title,
				...rendered,
				authorId: actor.id,
				created: now,
			});
			await tx.insert(spacePermissions).values(
				creatorPermissions.map((permission) => ({
					sourceId: newSourceId(),
					spaceId: created.id,
					permission,
					userId: actor.id,
				})),
			);
			const [withHome] = await tx
				.update(spaces)
				.set({ homePageId: home.id })
				.where(eq(spaces.id, created.id))
				.returning();
			return withHome as SpaceRow;
		});
	} catch (error) {
		if (pgCode(error) === "23505")
			fail(409, `Space key ${key} is already in use`);
		throw error;
	}
	return spaceSummary(space);
}

export async function updateSpace(
	actor: CurrentUser,
	key: string,
	body: z.infer<typeof updateSpaceBody>,
) {
	const space = await loadSpace(db, key);
	await requireGrant(actor, space.id, "administer");
	if (body.homePageId) {
		const [home] = await db
			.select({ id: pages.id })
			.from(pages)
			.where(
				and(
					eq(pages.id, body.homePageId),
					eq(pages.spaceId, space.id),
					eq(pages.status, "current"),
				),
			);
		if (!home) fail(400, "Home page must be a current page of the space");
	}
	const [row] = await db
		.update(spaces)
		.set({
			...(body.name !== undefined && { name: body.name }),
			...(body.description !== undefined && {
				descriptionHtml: descriptionHtml(body.description),
			}),
			...(body.homePageId !== undefined && { homePageId: body.homePageId }),
			updatedAt: new Date(),
		})
		.where(eq(spaces.id, space.id))
		.returning();
	if (!row) fail(404, "Space not found");
	return spaceSummary(row);
}

export async function setSpaceStatus(
	actor: CurrentUser,
	key: string,
	status: "archived" | "current",
) {
	const space = await loadSpace(db, key);
	await requireGrant(actor, space.id, "administer");
	const [row] = await db
		.update(spaces)
		.set({ status, updatedAt: new Date() })
		.where(eq(spaces.id, space.id))
		.returning();
	if (!row) fail(404, "Space not found");
	return spaceSummary(row);
}

export async function deleteSpace(actor: CurrentUser, key: string) {
	allow(actor.isAdmin, "Only an administrator can delete a space");
	const space = await loadSpace(db, key);
	const files = await db
		.select({ path: pageAttachments.storagePath })
		.from(pageAttachments)
		.innerJoin(pages, eq(pages.id, pageAttachments.pageId))
		.where(eq(pages.spaceId, space.id));
	await db.delete(spaces).where(eq(spaces.id, space.id));
	await removeOrphanFiles(files.map((file) => file.path));
}

export async function listSpacePermissions(actor: CurrentUser, key: string) {
	const space = await loadSpace(db, key);
	await requireGrant(actor, space.id, "administer");
	return permissionRows(space.id);
}

export async function replaceSpacePermissions(
	actor: CurrentUser,
	key: string,
	body: z.infer<typeof permissionsInput>,
) {
	const space = await loadSpace(db, key);
	await requireGrant(actor, space.id, "administer");

	const seen = new Set<string>();
	const rows: (typeof body.permissions)[number][] = [];
	for (const entry of body.permissions) {
		const targets =
			Number(entry.userId !== undefined) +
			Number(entry.groupName !== undefined) +
			Number(entry.anonymous === true);
		if (targets !== 1) {
			fail(
				400,
				"Each permission needs exactly one of userId, groupName or anonymous",
			);
		}
		const key = `${entry.permission}|${entry.userId ?? ""}|${entry.groupName ?? ""}|${entry.anonymous === true}`;
		if (seen.has(key)) continue;
		seen.add(key);
		rows.push(entry);
	}
	const userIds = [
		...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : []))),
	];
	if (userIds.length > 0) {
		const found = await db
			.select({ id: users.id })
			.from(users)
			.where(inArray(users.id, userIds));
		if (found.length !== userIds.length)
			fail(400, "Unknown user in permissions");
	}
	if (
		rows.some(
			(row) => row.permission === "administer" && row.anonymous === true,
		)
	) {
		fail(400, "Anonymous users cannot administer a space");
	}
	const groupNames = [
		...new Set(rows.flatMap((row) => (row.groupName ? [row.groupName] : []))),
	];
	if (groupNames.length > 0) {
		const found = await db
			.select({ name: groups.name })
			.from(groups)
			.where(
				sql`lower(${groups.name}) = any(${sql.param(groupNames.map((name) => name.toLowerCase()))}::text[])`,
			);
		if (found.length !== groupNames.length)
			fail(400, "Unknown group in permissions");
	}
	const keepsAdmin = rows.some(
		(row) =>
			row.permission === "administer" &&
			(row.userId === actor.id ||
				(row.groupName !== undefined && hasGroup(actor, row.groupName))),
	);
	if (!actor.isAdmin && !keepsAdmin) {
		fail(400, "This change would remove your own administer permission");
	}

	await db.transaction(async (tx) => {
		await tx
			.delete(spacePermissions)
			.where(eq(spacePermissions.spaceId, space.id));
		if (rows.length === 0) return;
		await tx.insert(spacePermissions).values(
			rows.map((row) => ({
				sourceId: newSourceId(),
				spaceId: space.id,
				permission: row.permission,
				userId: row.userId ?? null,
				groupName: row.groupName ?? null,
				anonymous: row.anonymous === true,
			})),
		);
	});
	return permissionRows(space.id);
}

export async function listSpaceTemplates(actor: CurrentUser, key: string) {
	const space = await loadSpace(db, key);
	await requireReadableSpace(actor, space.id);
	const rows = await db
		.select()
		.from(pageTemplates)
		.where(
			or(eq(pageTemplates.spaceId, space.id), isNull(pageTemplates.spaceId)),
		)
		.orderBy(pageTemplates.name);
	return rows.map((row) => ({
		id: row.id,
		spaceKey: row.spaceId ? space.key : null,
		name: row.name,
		description: row.description,
	}));
}

export async function getTemplate(actor: CurrentUser, id: string) {
	const [row] = await db
		.select({ template: pageTemplates, spaceKey: spaces.key })
		.from(pageTemplates)
		.leftJoin(spaces, eq(spaces.id, pageTemplates.spaceId))
		.where(eq(pageTemplates.id, id));
	if (!row) fail(404, "Template not found");
	if (row.template.spaceId) {
		await requireReadableSpace(actor, row.template.spaceId);
	}
	return templateDetail(row.template, row.spaceKey);
}

export async function createTemplate(
	actor: CurrentUser,
	key: string,
	body: z.infer<typeof templateBody>,
) {
	const space = await loadSpace(db, key);
	await requireGrant(actor, space.id, "administer");
	const doc = checkDoc(body.bodyDoc);
	const [row] = await db
		.insert(pageTemplates)
		.values({
			sourceId: newSourceId(),
			spaceId: space.id,
			name: body.name,
			description: body.description ?? null,
			bodyStorage: docToStorage(doc),
		})
		.returning();
	return templateDetail(row, space.key);
}

async function ownTemplate(actor: CurrentUser, id: string) {
	const [row] = await db
		.select({ template: pageTemplates, spaceKey: spaces.key })
		.from(pageTemplates)
		.leftJoin(spaces, eq(spaces.id, pageTemplates.spaceId))
		.where(eq(pageTemplates.id, id));
	if (!row) fail(404, "Template not found");
	if (row.template.spaceId) {
		const grants = await spaceGrants(actor, row.template.spaceId);
		allow(can(grants, "administer"));
	} else {
		allow(actor.isAdmin);
	}
	return row;
}

export async function updateTemplate(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof templateBody>,
) {
	const { template, spaceKey } = await ownTemplate(actor, id);
	const doc = checkDoc(body.bodyDoc);
	const [row] = await db
		.update(pageTemplates)
		.set({
			name: body.name,
			description: body.description ?? null,
			bodyStorage: docToStorage(doc),
			updatedAt: new Date(),
		})
		.where(eq(pageTemplates.id, template.id))
		.returning();
	if (!row) fail(404, "Template not found");
	return templateDetail(row, spaceKey);
}

export async function deleteTemplate(actor: CurrentUser, id: string) {
	const { template } = await ownTemplate(actor, id);
	await db.delete(pageTemplates).where(eq(pageTemplates.id, template.id));
}
