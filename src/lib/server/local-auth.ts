import { and, eq, ne, sql } from "drizzle-orm";
import { type CurrentUser, createSession, sha256 } from "./auth.ts";
import { db } from "./db.ts";
import { env, ssoConfigured } from "./env.ts";
import { HttpError } from "./http.ts";
import { safeReturnTo } from "./oidc.ts";
import { hashPassword, validatePassword, verifyPassword } from "./passwords.ts";
import {
	apiTokens,
	auditLog,
	loginThrottle,
	sessions,
	users,
} from "./schema.ts";

type AuditExecutor = Pick<typeof db, "insert">;

/** Audit rows written outside an admin request, where there may be no signed-in actor. */
export async function recordAudit(
	executor: AuditExecutor,
	row: typeof auditLog.$inferInsert,
) {
	await executor.insert(auditLog).values(row);
}

const GENERIC_FAILURE = "Incorrect username or password";
const LOCK_MINUTES = 15;
const STALE_MS = 60 * 60 * 1000;
const MAX_DELAY_SECONDS = 32;
const PURGE_EVERY_MS = 60 * 1000;

/**
 * From `delayFrom` failures a growing delay (2, 4, ... 32 s) separates attempts;
 * at `lockAt` failures the key is locked for 15 minutes. The IP counter has x5
 * thresholds so an office behind one NAT does not lock itself out.
 */
const limits = {
	user: { delayFrom: 5, lockAt: 10 },
	ip: { delayFrom: 25, lockAt: 50 },
} as const;

type ThrottleKind = keyof typeof limits;

let lastPurge = 0;

async function purgeStaleThrottle() {
	if (Date.now() - lastPurge < PURGE_EVERY_MS) return;
	lastPurge = Date.now();
	await db.execute(
		sql`delete from login_throttle where last_failure_at < now() - interval '1 hour' and (locked_until is null or locked_until < now())`,
	);
}

/**
 * Counts one attempt against the key before the password is checked, so a burst of
 * parallel requests cannot all slip past the limit. Returns 0 when the attempt may
 * proceed, otherwise the seconds to wait. A successful login clears the counters.
 */
async function reserveAttempt(kind: ThrottleKind, key: string) {
	await purgeStaleThrottle();
	const { delayFrom, lockAt } = limits[kind];
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`insert into login_throttle (kind, key) values (${kind}, ${key}) on conflict do nothing`,
		);
		const { rows } = await tx.execute<{
			failures: number;
			last: number;
			locked: number | null;
			now: number;
		}>(
			sql`select failures,
				(extract(epoch from last_failure_at) * 1000)::float8 as last,
				(extract(epoch from locked_until) * 1000)::float8 as locked,
				(extract(epoch from now()) * 1000)::float8 as now
			from login_throttle where kind = ${kind} and key = ${key} for update`,
		);
		const row = rows[0];
		if (!row) return 0;

		const { now, last, locked: lockedUntil } = row;
		if (lockedUntil !== null && lockedUntil > now) {
			return Math.ceil((lockedUntil - now) / 1000);
		}

		const expired =
			(lockedUntil !== null && lockedUntil <= now) || now - last > STALE_MS;
		const failures = expired ? 0 : row.failures;
		if (failures >= delayFrom) {
			const delay = Math.min(
				MAX_DELAY_SECONDS,
				2 ** (failures - delayFrom + 1),
			);
			const wait = last + delay * 1000 - now;
			if (wait > 0) return Math.ceil(wait / 1000);
		}

		const next = failures + 1;
		await tx
			.update(loginThrottle)
			.set({
				failures: next,
				lastFailureAt: sql`now()`,
				lockedUntil:
					next >= lockAt
						? sql`now() + interval '${sql.raw(String(LOCK_MINUTES))} minutes'`
						: null,
			})
			.where(and(eq(loginThrottle.kind, kind), eq(loginThrottle.key, key)));
		return 0;
	});
}

async function clearAttempts(kind: ThrottleKind, key: string) {
	await db
		.delete(loginThrottle)
		.where(and(eq(loginThrottle.kind, kind), eq(loginThrottle.key, key)));
}

/** One `login.locked` row per attempted name and minute, so a flood cannot fill the log. */
async function auditThrottled(typed: string, ip: string, seconds: number) {
	const name = typed.slice(0, 100);
	await db.execute(sql`
		insert into audit_log (actor_name, action, entity_type, summary)
		select ${name}, 'login.locked', 'login', ${`Login for "${name}" from ${ip} refused, retry in ${seconds} seconds`}
		where not exists (
			select 1 from audit_log
			where action = 'login.locked' and actor_name = ${name}
				and created_at > now() - interval '1 minute'
		)`);
}

function tooManyAttempts(seconds: number) {
	return new HttpError(429, "Too many failed attempts", {
		headers: { "Retry-After": String(seconds) },
	});
}

async function findLoginUser(typed: string) {
	const lower = typed.toLowerCase();
	const byUsername = await db
		.select()
		.from(users)
		.where(sql`lower(${users.username}) = ${lower}`)
		.limit(2);
	if (byUsername.length > 0) {
		return byUsername.length === 1 ? (byUsername[0] ?? null) : null;
	}
	const byEmail = await db
		.select()
		.from(users)
		.where(sql`lower(${users.email}) = ${lower}`)
		.limit(2);
	return byEmail.length === 1 ? (byEmail[0] ?? null) : null;
}

export type AuthConfig = {
	sso: boolean;
	ssoAutoRedirect: boolean;
	devLogin: boolean;
};

export function authConfig(): AuthConfig {
	return {
		sso: ssoConfigured(),
		ssoAutoRedirect: ssoConfigured() && env.SSO_AUTO_REDIRECT,
		devLogin: Boolean(env.DEV_LOGIN_USER) && env.NODE_ENV !== "production",
	};
}

export type LocalLoginInput = {
	username: string;
	password: string;
	returnTo?: string;
	ip: string;
	previousSessionId?: string;
};

export type LocalLoginResult = {
	session: string;
	redirect: string;
	mustChangePassword: boolean;
};

export async function loginLocal(
	input: LocalLoginInput,
): Promise<LocalLoginResult> {
	const { username, password, ip } = input;
	const key = username.toLowerCase();

	const wait =
		(await reserveAttempt("user", key)) || (await reserveAttempt("ip", ip));
	if (wait > 0) {
		await auditThrottled(username, ip, wait);
		throw tooManyAttempts(wait);
	}

	const user = await findLoginUser(username);
	const result = await verifyPassword(password, user?.passwordHash ?? null);

	if (!user?.active || !result.ok) {
		await recordAudit(db, {
			actorId: null,
			actorName: username.slice(0, 100),
			action: "login.failure",
			entityType: "user",
			entityId: user?.id ?? null,
			summary: `Failed login from ${ip}`,
		});
		throw new HttpError(401, GENERIC_FAILURE);
	}

	await clearAttempts("user", key);
	await clearAttempts("ip", ip);

	if (result.needsRehash) {
		await db
			.update(users)
			.set({ passwordHash: await hashPassword(password) })
			.where(
				and(
					eq(users.id, user.id),
					eq(users.passwordHash, user.passwordHash as string),
				),
			);
	}

	if (input.previousSessionId) {
		await db
			.delete(sessions)
			.where(eq(sessions.idHash, sha256(input.previousSessionId)));
	}
	const session = await createSession(user.id, null);
	await recordAudit(db, {
		actorId: user.id,
		actorName: user.displayName,
		action: "login.success",
		entityType: "user",
		entityId: user.id,
		summary: `${user.username} logged in from ${ip}`,
	});

	return {
		session,
		redirect: safeReturnTo(input.returnTo),
		mustChangePassword: user.mustChangePassword,
	};
}

export type ChangePasswordInput = {
	currentPassword: string;
	newPassword: string;
	ip: string;
	keepSessionId?: string;
};

export async function changePassword(
	actor: CurrentUser,
	input: ChangePasswordInput,
): Promise<void> {
	const [row] = await db
		.select({ passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.id, actor.id))
		.limit(1);
	if (!row?.passwordHash) {
		throw new HttpError(409, "This account signs in with SSO");
	}

	const key = actor.username.toLowerCase();
	const wait = await reserveAttempt("user", key);
	if (wait > 0) {
		await auditThrottled(actor.username, input.ip, wait);
		throw tooManyAttempts(wait);
	}

	const current = await verifyPassword(input.currentPassword, row.passwordHash);
	if (!current.ok) {
		await recordAudit(db, {
			actorId: actor.id,
			actorName: actor.displayName,
			action: "login.failure",
			entityType: "user",
			entityId: actor.id,
			summary: `Wrong current password when changing the password, from ${input.ip}`,
		});
		throw new HttpError(400, "The current password is incorrect");
	}
	await clearAttempts("user", key);

	const problem = validatePassword(input.newPassword, actor.username);
	if (problem) throw new HttpError(400, problem);
	if (input.newPassword === input.currentPassword) {
		throw new HttpError(
			400,
			"The new password must differ from the current password",
		);
	}

	const passwordHash = await hashPassword(input.newPassword);
	const changed = await db.transaction(async (tx) => {
		const now = new Date();
		const updated = await tx
			.update(users)
			.set({
				passwordHash,
				passwordChangedAt: now,
				mustChangePassword: false,
				updatedAt: now,
			})
			.where(
				and(
					eq(users.id, actor.id),
					eq(users.passwordHash, row.passwordHash as string),
				),
			)
			.returning({ id: users.id });
		if (updated.length === 0) return false;

		await tx
			.delete(sessions)
			.where(
				and(
					eq(sessions.userId, actor.id),
					input.keepSessionId
						? ne(sessions.idHash, sha256(input.keepSessionId))
						: undefined,
				),
			);
		await tx.delete(apiTokens).where(eq(apiTokens.userId, actor.id));
		await recordAudit(tx, {
			actorId: actor.id,
			actorName: actor.displayName,
			action: "password.change",
			entityType: "user",
			entityId: actor.id,
			summary: `${actor.username} changed their password`,
		});
		return true;
	});
	if (!changed) {
		throw new HttpError(
			409,
			"The password was changed in the meantime. Try again.",
		);
	}
}
