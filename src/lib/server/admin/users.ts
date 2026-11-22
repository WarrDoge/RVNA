import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import { userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { HttpError } from "../http.ts";
import {
	generatePassword,
	hashPassword,
	validatePassword,
} from "../passwords.ts";
import { requireAdminActor } from "../permissions.ts";
import { apiTokens, groups, sessions, userGroups, users } from "../schema.ts";
import { audit } from "./audit.ts";

const adminGuardLockKey = 7_418_529_632;

export const groupRefSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	local: z.boolean(),
});

export const adminUserSchema = z.object({
	id: z.uuid(),
	username: z.string(),
	displayName: z.string(),
	email: z.string().nullable(),
	avatarUrl: z.string().nullable(),
	active: z.boolean(),
	isAdmin: z.boolean(),
	adminLocal: z.boolean(),
	groups: z.array(groupRefSchema),
	lastLoginAt: z.iso.datetime().nullable(),
	createdAt: z.iso.datetime(),
	hasPassword: z.boolean(),
	hasSso: z.boolean(),
	mustChangePassword: z.boolean(),
	origin: z.enum(["sso", "imported", "local"]),
});

export const adminTokenSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	createdAt: z.iso.datetime(),
	lastUsedAt: z.iso.datetime().nullable(),
	expiresAt: z.iso.datetime().nullable(),
});

export const adminUserDetailSchema = adminUserSchema.extend({
	tokens: z.array(adminTokenSchema),
	sessionCount: z.number().int(),
});

export const userParams = z.object({ id: z.uuid() });
export const tokenParams = z.object({ id: z.uuid(), tokenId: z.uuid() });

export const userListQuery = z.object({
	query: z.string().trim().max(200).default(""),
	active: z.enum(["all", "true", "false"]).default("all"),
	group: z.string().trim().max(255).optional(),
	username: z.string().trim().max(100).optional(),
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const userCreateBody = z.object({
	username: z.string().trim().min(1).max(100),
	displayName: z.string().trim().min(1).max(255),
	email: z.string().trim().max(255).optional(),
	password: z.string().max(256).optional(),
	generatePassword: z.boolean().optional(),
	mustChangePassword: z.boolean().optional(),
	isAdmin: z.boolean().optional(),
});

export const userUpdateBody = z.object({
	displayName: z.string().trim().min(1).max(255).optional(),
	email: z.string().trim().max(255).nullable().optional(),
	isAdmin: z.boolean().optional(),
});

export const passwordBody = z.object({
	password: z.string().max(256).optional(),
	generate: z.boolean().optional(),
	mustChangePassword: z.boolean().optional(),
});

export const userResponseSchema = z.object({ user: adminUserSchema });

export const createdUserResponseSchema = z.object({
	user: adminUserSchema,
	generatedPassword: z.string().optional(),
});

export const userListResponseSchema = z.object({
	users: z.array(adminUserSchema),
	total: z.number().int(),
});

type GroupRef = { id: string; name: string; local: boolean };

type UserRow = {
	id: string;
	username: string;
	displayName: string;
	email: string | null;
	avatarUrl: string | null;
	active: boolean;
	isAdmin: boolean;
	adminLocal: boolean;
	lastLoginAt: Date | null;
	createdAt: Date;
	hasPassword: boolean;
	hasSso: boolean;
	mustChangePassword: boolean;
	sourceKey: string | null;
	groups: GroupRef[];
};

type Executor = Pick<typeof db, "select">;

/**
 * Groups as JSON so the browser list stays one query instead of one per user.
 * The outer column is spelled out: a bare "id" inside the subquery would bind to
 * the joined group, not to the user.
 */
const groupAggregate = sql<GroupRef[]>`coalesce((
	select json_agg(json_build_object('id', g.id, 'name', g.name, 'local', g.local) order by lower(g.name))
	from groups g
	where g.id in (select ug.group_id from user_groups ug where ug.user_id = users.id)
), '[]'::json)`;

const userColumns = {
	id: users.id,
	username: users.username,
	displayName: users.displayName,
	email: users.email,
	avatarUrl: userAvatarSql(users.id),
	active: users.active,
	isAdmin: users.isAdmin,
	adminLocal: users.adminLocal,
	lastLoginAt: users.lastLoginAt,
	createdAt: users.createdAt,
	hasPassword: sql<boolean>`${users.passwordHash} is not null`,
	hasSso: sql<boolean>`${users.oidcSub} is not null`,
	mustChangePassword: users.mustChangePassword,
	sourceKey: users.sourceKey,
	groups: groupAggregate,
};

function toAdminUser(row: UserRow) {
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		email: row.email,
		avatarUrl: row.avatarUrl,
		active: row.active,
		isAdmin: row.isAdmin,
		adminLocal: row.adminLocal,
		groups: row.groups,
		lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		hasPassword: row.hasPassword,
		hasSso: row.hasSso,
		mustChangePassword: row.mustChangePassword,
		origin: row.hasSso
			? ("sso" as const)
			: row.sourceKey
				? ("imported" as const)
				: ("local" as const),
	};
}

async function loadAdminUser(executor: Executor, id: string) {
	const [row] = await executor
		.select(userColumns)
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	return row ? toAdminUser(row) : null;
}

function likePattern(value: string) {
	return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function isUniqueViolation(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}

/** Email as stored: empty becomes null, and anything else must parse. */
function normalizeEmail(value: string | null | undefined) {
	const trimmed = value?.trim() ?? "";
	if (trimmed === "") return { email: null, error: null };
	if (!z.email().safeParse(trimmed).success) {
		return { email: null, error: "Enter a valid email address" };
	}
	return { email: trimmed, error: null };
}

async function lockEmail(executor: Pick<typeof db, "execute">, email: string) {
	await executor.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(lower(${email}), 0))`,
	);
}

async function emailTaken(
	executor: Executor,
	email: string,
	exceptId?: string,
) {
	const [row] = await executor
		.select({ id: users.id })
		.from(users)
		.where(
			and(
				sql`lower(${users.email}) = lower(${email})`,
				exceptId ? ne(users.id, exceptId) : undefined,
			),
		)
		.limit(1);
	return Boolean(row);
}

async function usernameTaken(executor: Executor, username: string) {
	const [row] = await executor
		.select({ id: users.id })
		.from(users)
		.where(sql`lower(${users.username}) = lower(${username})`)
		.limit(1);
	return Boolean(row);
}

async function inAdminGroup(executor: Executor, userId: string) {
	const [row] = await executor
		.select({ id: userGroups.groupId })
		.from(userGroups)
		.innerJoin(groups, eq(groups.id, userGroups.groupId))
		.where(
			and(
				eq(userGroups.userId, userId),
				sql`lower(${groups.name}) = lower(${env.ADMIN_GROUP})`,
			),
		)
		.limit(1);
	return Boolean(row);
}

async function otherActiveAdmins(executor: Executor, userId: string) {
	const [row] = await executor
		.select({ total: sql<number>`count(*)::int` })
		.from(users)
		.where(
			and(
				eq(users.active, true),
				eq(users.isAdmin, true),
				ne(users.id, userId),
			),
		);
	return row?.total ?? 0;
}

export async function listUsers(
	_actor: CurrentUser,
	query: z.infer<typeof userListQuery>,
) {
	requireAdminActor(_actor);
	const { query: search, active, group, username, offset, limit } = query;

	const filters = [
		search === ""
			? undefined
			: or(
					ilike(users.displayName, likePattern(search)),
					ilike(users.username, likePattern(search)),
					ilike(users.email, likePattern(search)),
				),
		active === "all" ? undefined : eq(users.active, active === "true"),
		username === undefined
			? undefined
			: sql`lower(${users.username}) = lower(${username})`,
		group === undefined
			? undefined
			: sql`exists (
					select 1 from user_groups ug
					join groups g on g.id = ug.group_id
					where ug.user_id = users.id and lower(g.name) = lower(${group})
				)`,
	].filter((filter) => filter !== undefined);
	const where = filters.length > 0 ? and(...filters) : undefined;

	const [counted] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(users)
		.where(where);

	const rows = await db
		.select(userColumns)
		.from(users)
		.where(where)
		.orderBy(sql`lower(${users.displayName})`, users.username)
		.limit(limit)
		.offset(offset);

	return {
		users: rows.map(toAdminUser),
		total: counted?.total ?? 0,
	};
}

export async function getUser(_actor: CurrentUser, id: string) {
	requireAdminActor(_actor);
	const user = await loadAdminUser(db, id);
	if (!user) throw new HttpError(404, "User not found");

	const tokens = await db
		.select({
			id: apiTokens.id,
			name: apiTokens.name,
			createdAt: apiTokens.createdAt,
			lastUsedAt: apiTokens.lastUsedAt,
			expiresAt: apiTokens.expiresAt,
		})
		.from(apiTokens)
		.where(eq(apiTokens.userId, user.id))
		.orderBy(desc(apiTokens.createdAt));

	const [counted] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(sessions)
		.where(eq(sessions.userId, user.id));

	return {
		...user,
		sessionCount: counted?.total ?? 0,
		tokens: tokens.map((token) => ({
			id: token.id,
			name: token.name,
			createdAt: token.createdAt.toISOString(),
			lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
			expiresAt: token.expiresAt?.toISOString() ?? null,
		})),
	};
}

export async function createUser(
	actor: CurrentUser,
	body: z.infer<typeof userCreateBody>,
) {
	requireAdminActor(actor);
	const { username, displayName } = body;
	if (/\s/.test(username)) {
		throw new HttpError(400, "The username must not contain spaces");
	}

	const normalized = normalizeEmail(body.email);
	if (normalized.error) throw new HttpError(400, normalized.error);
	const email = normalized.email;

	const generate = body.generatePassword === true;
	if (generate && body.password !== undefined) {
		throw new HttpError(400, "Enter a password or generate one, not both");
	}

	let generatedPassword: string | undefined;
	let password: string | undefined;
	if (generate) {
		generatedPassword = generatePassword();
		password = generatedPassword;
	} else if (body.password !== undefined) {
		password = body.password;
	}
	if (password !== undefined) {
		const problem = validatePassword(password, username);
		if (problem) throw new HttpError(400, problem);
	}

	const isAdmin = body.isAdmin ?? false;
	const mustChangePassword = body.mustChangePassword ?? generate;
	const passwordHash = password ? await hashPassword(password) : null;

	try {
		const created: { id: string | null; conflict: string | null } =
			await db.transaction(async (tx) => {
				if (email) await lockEmail(tx, email);
				if (await usernameTaken(tx, username)) {
					return {
						id: null,
						conflict: "A user with this username already exists",
					};
				}
				if (email && (await emailTaken(tx, email))) {
					return {
						id: null,
						conflict: "A user with this email address already exists",
					};
				}

				const [row] = await tx
					.insert(users)
					.values({
						username,
						displayName,
						email,
						isAdmin,
						adminLocal: isAdmin,
						passwordHash,
						passwordChangedAt: passwordHash ? new Date() : null,
						mustChangePassword: passwordHash ? mustChangePassword : false,
					})
					.returning({ id: users.id });

				await audit(tx, actor, {
					action: "user.create",
					entityType: "user",
					entityId: row.id,
					summary: `Created user ${username}`,
					changes: {
						from: null,
						to: {
							username,
							displayName,
							email,
							isAdmin,
							hasPassword: Boolean(passwordHash),
						},
					},
				});
				return { id: row.id, conflict: null };
			});

		if (created.conflict) throw new HttpError(409, created.conflict);
		if (!created.id) throw new Error("Created user has no id");
		const user = await loadAdminUser(db, created.id);
		if (!user) throw new Error("Created user disappeared");
		return generatedPassword ? { user, generatedPassword } : { user };
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new HttpError(
				409,
				"A user with this username or email address already exists",
			);
		}
		throw error;
	}
}

export async function updateUser(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof userUpdateBody>,
) {
	requireAdminActor(actor);
	const [current] = await db
		.select()
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	if (!current) throw new HttpError(404, "User not found");

	const normalized = normalizeEmail(body.email);
	if (normalized.error) throw new HttpError(400, normalized.error);

	const nextDisplayName = body.displayName ?? current.displayName;
	const nextEmail = body.email === undefined ? current.email : normalized.email;
	const nextAdminLocal = body.isAdmin ?? current.adminLocal;

	const from: Record<string, unknown> = {};
	const to: Record<string, unknown> = {};
	if (nextDisplayName !== current.displayName) {
		from.displayName = current.displayName;
		to.displayName = nextDisplayName;
	}
	if (nextEmail !== current.email) {
		from.email = current.email;
		to.email = nextEmail;
	}
	if (nextAdminLocal !== current.adminLocal) {
		from.adminLocal = current.adminLocal;
		to.adminLocal = nextAdminLocal;
	}

	await db.transaction(async (tx) => {
		if (nextEmail && nextEmail !== current.email) {
			await lockEmail(tx, nextEmail);
			if (await emailTaken(tx, nextEmail, current.id)) {
				throw new HttpError(
					409,
					"A user with this email address already exists",
				);
			}
		}
		if (body.isAdmin === false) {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${adminGuardLockKey}::bigint)`,
			);
		}
		const [fresh] = await tx
			.select({ isAdmin: users.isAdmin })
			.from(users)
			.where(eq(users.id, current.id))
			.for("update");
		if (!fresh) throw new HttpError(404, "User not found");
		const isAdmin = nextAdminLocal || (await inAdminGroup(tx, current.id));
		if (fresh.isAdmin && !isAdmin) {
			if ((await otherActiveAdmins(tx, current.id)) === 0) {
				throw new HttpError(409, "You cannot remove the last administrator");
			}
		}
		await tx
			.update(users)
			.set({
				displayName: nextDisplayName,
				email: nextEmail,
				adminLocal: nextAdminLocal,
				isAdmin,
				updatedAt: new Date(),
			})
			.where(eq(users.id, current.id));

		if (Object.keys(to).length > 0) {
			await audit(tx, actor, {
				action: "user.update",
				entityType: "user",
				entityId: current.id,
				summary: `Updated user ${current.username}`,
				changes: { from, to },
			});
		}
	});

	const user = await loadAdminUser(db, current.id);
	if (!user) throw new HttpError(404, "User not found");
	return { user };
}

export async function setUserPassword(
	actor: CurrentUser,
	id: string,
	body: z.infer<typeof passwordBody>,
) {
	requireAdminActor(actor);
	const [current] = await db
		.select()
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	if (!current) throw new HttpError(404, "User not found");

	const generate = body.generate === true;
	if (generate && body.password !== undefined) {
		throw new HttpError(400, "Enter a password or generate one, not both");
	}
	if (!generate && body.password === undefined) {
		throw new HttpError(400, "Enter a password or generate one");
	}

	const generatedPassword = generate ? generatePassword() : undefined;
	const password = generatedPassword ?? body.password ?? "";
	const problem = validatePassword(password, current.username);
	if (problem) throw new HttpError(400, problem);

	const mustChangePassword = body.mustChangePassword ?? generate;
	const passwordHash = await hashPassword(password);

	await db.transaction(async (tx) => {
		await tx
			.update(users)
			.set({
				passwordHash,
				passwordChangedAt: new Date(),
				mustChangePassword,
				updatedAt: new Date(),
			})
			.where(eq(users.id, current.id));
		await tx.delete(sessions).where(eq(sessions.userId, current.id));
		const revoked = await tx
			.delete(apiTokens)
			.where(eq(apiTokens.userId, current.id))
			.returning({ id: apiTokens.id });

		await audit(tx, actor, {
			action: "user.password.set",
			entityType: "user",
			entityId: current.id,
			summary: `Set a password for ${current.username}`,
			changes: {
				from: { hasPassword: current.passwordHash !== null },
				to: {
					hasPassword: true,
					mustChangePassword,
					apiTokensRevoked: revoked.length,
				},
			},
		});
	});

	const user = await loadAdminUser(db, current.id);
	if (!user) throw new HttpError(404, "User not found");
	return generatedPassword ? { user, generatedPassword } : { user };
}

export async function removeUserPassword(actor: CurrentUser, id: string) {
	requireAdminActor(actor);
	const [current] = await db
		.select()
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	if (!current) throw new HttpError(404, "User not found");
	if (current.passwordHash === null) {
		throw new HttpError(409, "This user has no password");
	}
	if (current.oidcSub === null) {
		throw new HttpError(
			409,
			"This user has no SSO identity, so removing the password would lock them out",
		);
	}

	await db.transaction(async (tx) => {
		await tx
			.update(users)
			.set({
				passwordHash: null,
				passwordChangedAt: null,
				mustChangePassword: false,
				updatedAt: new Date(),
			})
			.where(eq(users.id, current.id));
		await tx.delete(sessions).where(eq(sessions.userId, current.id));
		const revoked = await tx
			.delete(apiTokens)
			.where(eq(apiTokens.userId, current.id))
			.returning({ id: apiTokens.id });

		await audit(tx, actor, {
			action: "user.password.remove",
			entityType: "user",
			entityId: current.id,
			summary: `Removed the password of ${current.username}`,
			changes: {
				from: { hasPassword: true },
				to: { hasPassword: false, apiTokensRevoked: revoked.length },
			},
		});
	});

	const user = await loadAdminUser(db, current.id);
	if (!user) throw new HttpError(404, "User not found");
	return { user };
}

export async function deactivateUser(actor: CurrentUser, id: string) {
	requireAdminActor(actor);
	const [current] = await db
		.select()
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	if (!current) throw new HttpError(404, "User not found");
	if (current.id === actor.id) {
		throw new HttpError(409, "You cannot deactivate your own account");
	}

	if (current.active) {
		await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${adminGuardLockKey}::bigint)`,
			);
			const [fresh] = await tx
				.select({ active: users.active, isAdmin: users.isAdmin })
				.from(users)
				.where(eq(users.id, current.id))
				.for("update");
			if (!fresh) throw new HttpError(404, "User not found");
			if (
				fresh.active &&
				fresh.isAdmin &&
				(await otherActiveAdmins(tx, current.id)) === 0
			) {
				throw new HttpError(
					409,
					"You cannot deactivate the last administrator",
				);
			}
			if (!fresh.active) return;

			await tx
				.update(users)
				.set({ active: false, updatedAt: new Date() })
				.where(eq(users.id, current.id));
			await tx.delete(sessions).where(eq(sessions.userId, current.id));
			await tx.delete(apiTokens).where(eq(apiTokens.userId, current.id));

			await audit(tx, actor, {
				action: "user.deactivate",
				entityType: "user",
				entityId: current.id,
				summary: `Deactivated user ${current.username}`,
				changes: { from: { active: true }, to: { active: false } },
			});
		});
	}

	const user = await loadAdminUser(db, current.id);
	if (!user) throw new HttpError(404, "User not found");
	return { user };
}

export async function reactivateUser(actor: CurrentUser, id: string) {
	requireAdminActor(actor);
	const [current] = await db
		.select()
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	if (!current) throw new HttpError(404, "User not found");

	if (!current.active) {
		await db.transaction(async (tx) => {
			await tx
				.update(users)
				.set({ active: true, updatedAt: new Date() })
				.where(eq(users.id, current.id));

			await audit(tx, actor, {
				action: "user.reactivate",
				entityType: "user",
				entityId: current.id,
				summary: `Reactivated user ${current.username}`,
				changes: { from: { active: false }, to: { active: true } },
			});
		});
	}

	const user = await loadAdminUser(db, current.id);
	if (!user) throw new HttpError(404, "User not found");
	return { user };
}

export async function revokeUserToken(
	actor: CurrentUser,
	id: string,
	tokenId: string,
) {
	requireAdminActor(actor);
	const [current] = await db
		.select({ id: users.id, username: users.username })
		.from(users)
		.where(eq(users.id, id))
		.limit(1);
	if (!current) throw new HttpError(404, "User not found");

	const revoked = await db.transaction(async (tx) => {
		const [deleted] = await tx
			.delete(apiTokens)
			.where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, current.id)))
			.returning({ id: apiTokens.id, name: apiTokens.name });
		if (!deleted) return null;

		await audit(tx, actor, {
			action: "user.token.revoke",
			entityType: "user",
			entityId: current.id,
			summary: `Revoked an API token of ${current.username}`,
			changes: { from: { token: deleted.name }, to: null },
		});
		return deleted;
	});

	if (!revoked) throw new HttpError(404, "Token not found");
}
