import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { userAvatarUrl } from "./avatars.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import {
	apiTokens,
	groups,
	permissionGrants,
	permissionSchemes,
	sessions,
	userGroups,
	users,
} from "./schema.ts";

export const SESSION_COOKIE = "sid";
export const TRANSACTION_COOKIE = "oidc_transaction";

export type CurrentUser = {
	id: string;
	username: string;
	displayName: string;
	email: string | null;
	avatarUrl: string | null;
	groups: string[];
	isAdmin: boolean;
	mustChangePassword: boolean;
	hasPassword: boolean;
};

function sessionTtlMs() {
	return env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

function secureCookies() {
	return env.APP_URL.startsWith("https://");
}

export function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

export function randomValue() {
	return randomBytes(32).toString("base64url");
}

export function sessionCookieOptions() {
	return {
		path: "/",
		httpOnly: true,
		sameSite: "lax" as const,
		secure: secureCookies(),
		maxAge: Math.floor(sessionTtlMs() / 1000),
	};
}

export function clearCookieOptions(path: string) {
	return {
		path,
		httpOnly: false,
		sameSite: false as const,
		secure: false,
		maxAge: 0,
		expires: new Date(0),
	};
}

export function transactionCookieOptions() {
	return {
		path: "/auth",
		httpOnly: true,
		sameSite: "lax" as const,
		secure: secureCookies(),
		maxAge: 10 * 60,
	};
}

export async function createSession(userId: string, idToken: string | null) {
	const value = randomValue();
	await db.transaction(async (tx) => {
		await tx.insert(sessions).values({
			idHash: sha256(value),
			userId,
			idToken,
			expiresAt: new Date(Date.now() + sessionTtlMs()),
		});
		await tx
			.update(users)
			.set({ lastLoginAt: new Date() })
			.where(eq(users.id, userId));
	});
	return value;
}

/**
 * The groups a user is in, from every source: the OIDC claim of the last login,
 * the Jira and Confluence imports, and local groups. Every permission decision
 * (projects, filters, wiki spaces and restrictions, service desk) reads this.
 */
export async function effectiveGroups(
	userId: string,
	executor: Pick<typeof db, "select"> = db,
): Promise<string[]> {
	const memberships = await executor
		.select({ name: groups.name })
		.from(userGroups)
		.innerJoin(groups, eq(groups.id, userGroups.groupId))
		.where(eq(userGroups.userId, userId))
		.orderBy(groups.name);
	return [...new Set(memberships.map((membership) => membership.name))];
}

/** Group names compare without case: Jira, Confluence and the claim spell them differently. */
export function hasGroup(user: { groups: string[] }, name: string) {
	const needle = name.toLowerCase();
	return user.groups.some((group) => group.toLowerCase() === needle);
}

/**
 * The imported global ADMINISTER permission, held by the user or by one of the
 * user's effective groups (a group the SSO claim names counts like any other).
 */
async function holdsGlobalAdminister(username: string, groupNames: string[]) {
	const names = groupNames.map((name) => name.toLowerCase());
	const [row] = await db
		.select({ id: permissionGrants.id })
		.from(permissionGrants)
		.innerJoin(
			permissionSchemes,
			eq(permissionSchemes.id, permissionGrants.schemeId),
		)
		.where(
			and(
				eq(permissionSchemes.sourceId, "global"),
				eq(permissionGrants.permissionKey, "ADMINISTER"),
				or(
					and(
						eq(permissionGrants.holderType, "user"),
						sql`lower(${permissionGrants.holderParameter}) = ${username.toLowerCase()}`,
					),
					names.length > 0
						? and(
								eq(permissionGrants.holderType, "group"),
								sql`lower(${permissionGrants.holderParameter}) = any(${sql.param(names)}::text[])`,
							)
						: undefined,
				),
			),
		)
		.limit(1);
	return Boolean(row);
}

export async function loadUser(userId: string): Promise<CurrentUser | null> {
	const [row] = await db
		.select()
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!row?.active) return null;

	const memberships = await effectiveGroups(userId);
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		email: row.email,
		avatarUrl: userAvatarUrl(row.id),
		groups: memberships,
		isAdmin:
			row.isAdmin || (await holdsGlobalAdminister(row.username, memberships)),
		mustChangePassword: row.mustChangePassword,
		hasPassword: row.passwordHash !== null,
	};
}

/**
 * Replaces the user's memberships of SSO groups. Local groups are never touched,
 * and an SSO claim that names a local group does not join it.
 */
export async function syncGroups(userId: string, groupNames: string[]) {
	await db.transaction(async (tx) => {
		// Memberships of a login replace only the ones that came from the OIDC
		// claim; imported ("jira") and local ones stay.
		await tx
			.delete(userGroups)
			.where(and(eq(userGroups.userId, userId), eq(userGroups.source, "oidc")));
		for (const name of groupNames) {
			// Jira and the claim spell a group differently ("Jira-Users" and
			// "jira-users"): one name without case is one group.
			let [group] = await tx
				.select()
				.from(groups)
				.where(sql`lower(${groups.name}) = ${name.toLowerCase()}`)
				.orderBy(groups.name)
				.limit(1);
			if (!group) {
				[group] = await tx
					.insert(groups)
					.values({ name, local: false })
					.onConflictDoUpdate({ target: groups.name, set: { name } })
					.returning();
			}
			if (group && !group.local) {
				await tx
					.insert(userGroups)
					.values({ userId, groupId: group.id, source: "oidc" })
					.onConflictDoNothing();
			}
		}

		await tx
			.update(users)
			.set({
				isAdmin: groupNames.includes(env.ADMIN_GROUP)
					? true
					: sql`${users.adminLocal}`,
			})
			.where(eq(users.id, userId));
	});
}

/** The router matches the decoded path ("/%61pi" is "/api"), so path tests must too. */
export function requestPath(url: string) {
	const path = url.split("?")[0] ?? url;
	try {
		return decodeURI(path);
	} catch {
		return path;
	}
}

export async function userForToken(token: string): Promise<CurrentUser | null> {
	const tokenHash = sha256(token);
	const [row] = await db
		.select({ userId: apiTokens.userId })
		.from(apiTokens)
		.innerJoin(users, eq(users.id, apiTokens.userId))
		.where(
			and(
				eq(apiTokens.tokenHash, tokenHash),
				eq(users.active, true),
				or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
			),
		)
		.limit(1);
	if (!row) return null;

	await db
		.update(apiTokens)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiTokens.tokenHash, tokenHash));

	return loadUser(row.userId);
}

export async function userForSession(
	sessionId: string | undefined,
): Promise<CurrentUser | null> {
	if (!sessionId) return null;
	const [session] = await db
		.select({ userId: sessions.userId })
		.from(sessions)
		.where(
			and(
				eq(sessions.idHash, sha256(sessionId)),
				gt(sessions.expiresAt, new Date()),
			),
		)
		.limit(1);
	return session ? loadUser(session.userId) : null;
}
