import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { requireAdminActor } from "../permissions.ts";
import {
	groups,
	permissionGrants,
	permissionLocalRemovals,
	permissionSchemes,
	users,
} from "../schema.ts";
import { audit } from "./audit.ts";

export const holderParams = z.object({ id: z.uuid() });

export const holderSchema = z.object({
	id: z.uuid(),
	holderType: z.enum(["user", "group"]),
	holderParameter: z.string(),
	source: z.enum(["imported", "local"]),
});

export const addHolderBody = z.object({
	holderType: z.enum(["user", "group"]),
	holderParameter: z.string().trim().min(1).max(255),
});

export const holderResponseSchema = z.object({ holder: holderSchema });

function isLocal(sourceId: string) {
	return sourceId.startsWith("local:");
}

async function globalScheme() {
	const [row] = await db
		.select()
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, "global"))
		.limit(1);
	return row ?? null;
}

async function ensureGlobalScheme() {
	const existing = await globalScheme();
	if (existing) return existing;
	const [created] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: "global",
			name: "Global permissions",
			description: "Global permission holders imported from Jira",
			projectIds: [],
			raw: {},
		})
		.onConflictDoNothing()
		.returning();
	if (created) return created;
	const raced = await globalScheme();
	if (!raced) throw new Error("Global permission scheme was not created");
	return raced;
}

async function holdersFor(schemeId: string) {
	const rows = await db
		.select({
			id: permissionGrants.id,
			holderType: permissionGrants.holderType,
			holderParameter: permissionGrants.holderParameter,
			sourceId: permissionGrants.sourceId,
		})
		.from(permissionGrants)
		.where(
			and(
				eq(permissionGrants.schemeId, schemeId),
				eq(permissionGrants.permissionKey, "ADMINISTER"),
			),
		)
		.orderBy(
			sql`lower(${permissionGrants.holderType})`,
			sql`lower(${permissionGrants.holderParameter})`,
		);
	return rows
		.filter(
			(row) =>
				(row.holderType === "user" || row.holderType === "group") &&
				row.holderParameter !== null,
		)
		.map((row) => ({
			id: row.id,
			holderType: row.holderType as "user" | "group",
			holderParameter: row.holderParameter as string,
			source: isLocal(row.sourceId)
				? ("local" as const)
				: ("imported" as const),
		}));
}

export async function listGlobalPermissions(actor: CurrentUser) {
	requireAdminActor(actor);
	const scheme = await globalScheme();
	return { holders: scheme ? await holdersFor(scheme.id) : [] };
}

export async function addGlobalPermission(
	actor: CurrentUser,
	body: z.infer<typeof addHolderBody>,
) {
	requireAdminActor(actor);
	let parameter: string;
	if (body.holderType === "user") {
		const [user] = await db
			.select({ username: users.username })
			.from(users)
			.where(
				sql`lower(${users.username}) = ${body.holderParameter.toLowerCase()}`,
			)
			.limit(1);
		if (!user) throw new HttpError(404, "User not found");
		parameter = user.username;
	} else {
		const [group] = await db
			.select({ name: groups.name })
			.from(groups)
			.where(sql`lower(${groups.name}) = ${body.holderParameter.toLowerCase()}`)
			.limit(1);
		if (!group) throw new HttpError(404, "Group not found");
		parameter = group.name;
	}

	const scheme = await ensureGlobalScheme();
	const result = await db.transaction(async (tx) => {
		await tx
			.select({ id: permissionSchemes.id })
			.from(permissionSchemes)
			.where(eq(permissionSchemes.id, scheme.id))
			.for("update");
		const [existing] = await tx
			.select({
				id: permissionGrants.id,
				sourceId: permissionGrants.sourceId,
				holderType: permissionGrants.holderType,
				holderParameter: permissionGrants.holderParameter,
			})
			.from(permissionGrants)
			.where(
				and(
					eq(permissionGrants.schemeId, scheme.id),
					eq(permissionGrants.permissionKey, "ADMINISTER"),
					eq(permissionGrants.holderType, body.holderType),
					sql`lower(${permissionGrants.holderParameter}) = ${parameter.toLowerCase()}`,
				),
			)
			.limit(1);
		if (existing) return { grant: existing, created: false as const };

		const [grant] = await tx
			.insert(permissionGrants)
			.values({
				sourceId: `local:${randomUUID()}`,
				schemeId: scheme.id,
				permissionKey: "ADMINISTER",
				holderType: body.holderType,
				holderParameter: parameter,
				raw: {
					permission: "ADMINISTER",
					holder: {
						type: body.holderType,
						parameter,
					},
				},
			})
			.returning();
		await audit(tx, actor, {
			action: "global.permission.add",
			entityType: "permission_scheme",
			entityId: scheme.id,
			summary: `Granted global ADMINISTER to ${body.holderType} ${parameter}`,
			changes: {
				from: null,
				to: {
					permission: "ADMINISTER",
					holderType: body.holderType,
					holder: parameter,
				},
			},
		});
		return { grant, created: true as const };
	});

	return {
		holder: {
			id: result.grant.id,
			holderType: result.grant.holderType as "user" | "group",
			holderParameter: result.grant.holderParameter as string,
			source: isLocal(result.grant.sourceId)
				? ("local" as const)
				: ("imported" as const),
		},
		created: result.created,
	};
}

export async function removeGlobalPermission(actor: CurrentUser, id: string) {
	requireAdminActor(actor);
	const [row] = await db
		.select({
			id: permissionGrants.id,
			schemeId: permissionGrants.schemeId,
			holderType: permissionGrants.holderType,
			holderParameter: permissionGrants.holderParameter,
			sourceId: permissionGrants.sourceId,
		})
		.from(permissionGrants)
		.innerJoin(
			permissionSchemes,
			eq(permissionSchemes.id, permissionGrants.schemeId),
		)
		.where(
			and(
				eq(permissionGrants.id, id),
				eq(permissionGrants.permissionKey, "ADMINISTER"),
				eq(permissionSchemes.sourceId, "global"),
			),
		)
		.limit(1);
	if (!row) {
		throw new HttpError(404, "Global permission holder not found");
	}

	await db.transaction(async (tx) => {
		await tx.delete(permissionGrants).where(eq(permissionGrants.id, row.id));
		if (!isLocal(row.sourceId)) {
			await tx
				.insert(permissionLocalRemovals)
				.values({ sourceId: row.sourceId })
				.onConflictDoNothing();
		}
		await audit(tx, actor, {
			action: "global.permission.remove",
			entityType: "permission_scheme",
			entityId: row.schemeId,
			summary: `Removed global ADMINISTER from ${row.holderType} ${row.holderParameter}`,
			changes: {
				from: {
					permission: "ADMINISTER",
					holderType: row.holderType,
					holder: row.holderParameter,
				},
				to: null,
			},
		});
	});
}
