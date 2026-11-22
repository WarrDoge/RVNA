import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { recordAudit } from "./local-auth.ts";
import { hashPassword, validatePassword } from "./passwords.ts";
import { apiTokens, sessions, users } from "./schema.ts";

type Executor = Pick<typeof db, "transaction">;

/** Held while the first administrator is created so two replicas cannot both do it. */
const BOOTSTRAP_LOCK = 7_203_117_041;

export class InvalidUserInput extends Error {}

/** Driver errors carry the bound parameters, which here include password hashes. */
export function safeMessage(error: unknown) {
	if (error instanceof Error && error.cause instanceof Error) {
		return error.cause.message;
	}
	return error instanceof Error
		? (error.message.split("\n")[0] ?? "error")
		: "error";
}

export function validateUsername(username: string) {
	return /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,99}$/.test(username)
		? null
		: "The username must be 1 to 100 characters: letters, digits and . _ @ + -";
}

/** Empty clears the address; anything else must parse. */
function emailValue(email: string | undefined) {
	if (email === undefined) return { email: undefined, problem: null };
	const trimmed = email.trim();
	if (trimmed === "") return { email: null, problem: null };
	if (!z.email().safeParse(trimmed).success) {
		return { email: null, problem: "Enter a valid email address" };
	}
	return { email: trimmed, problem: null };
}

export type LocalUserInput = {
	username: string;
	password: string;
	/** A hash computed before the transaction, for callers that hold a lock. */
	passwordHash?: string;
	displayName?: string;
	email?: string;
	admin?: boolean;
	mustChangePassword?: boolean;
	/** Fail instead of updating when the username is taken. */
	createOnly?: boolean;
	actorName: string;
};

/** Creates a local user, or sets the password of the existing user with that username. */
export async function saveLocalUser(
	database: Executor,
	input: LocalUserInput,
): Promise<{ action: "created" | "updated"; active: boolean }> {
	const problem =
		validateUsername(input.username) ??
		validatePassword(input.password, input.username);
	if (problem) throw new InvalidUserInput(problem);
	const email = emailValue(input.email);
	if (email.problem) throw new InvalidUserInput(email.problem);
	const passwordHash =
		input.passwordHash ?? (await hashPassword(input.password));
	const now = new Date();

	return database.transaction(async (tx) => {
		// Two spellings of one name must not both insert; lock the name without case.
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${input.username.toLowerCase()})::bigint)`,
		);
		const [existing] = await tx
			.select()
			.from(users)
			.where(sql`lower(${users.username}) = ${input.username.toLowerCase()}`)
			.for("update")
			.limit(1);

		if (existing) {
			if (input.createOnly) {
				throw new InvalidUserInput(
					`The user ${existing.username} already exists. Use "npm run user:create" to change its password.`,
				);
			}
			if (existing.oidcSub) {
				throw new InvalidUserInput("This account signs in with SSO");
			}
			await tx
				.update(users)
				.set({
					passwordHash,
					passwordChangedAt: now,
					mustChangePassword: input.mustChangePassword ?? false,
					...(input.admin && { adminLocal: true, isAdmin: true }),
					...(input.displayName && { displayName: input.displayName }),
					...(email.email !== undefined && { email: email.email }),
					updatedAt: now,
				})
				.where(eq(users.id, existing.id));
			await tx.delete(sessions).where(eq(sessions.userId, existing.id));
			const revoked = await tx
				.delete(apiTokens)
				.where(eq(apiTokens.userId, existing.id))
				.returning({ id: apiTokens.id });
			await recordAudit(tx, {
				actorId: null,
				actorName: input.actorName,
				action: "user.update",
				entityType: "user",
				entityId: existing.id,
				summary: `Set a new password for user ${existing.username}`,
				changes: { to: { apiTokensRevoked: revoked.length } },
			});
			return { action: "updated", active: existing.active };
		}

		const [created] = await tx
			.insert(users)
			.values({
				username: input.username,
				displayName: input.displayName || input.username,
				email: email.email ?? null,
				passwordHash,
				passwordChangedAt: now,
				mustChangePassword: input.mustChangePassword ?? false,
				isAdmin: input.admin ?? false,
				adminLocal: input.admin ?? false,
			})
			.returning({ id: users.id });
		await recordAudit(tx, {
			actorId: null,
			actorName: input.actorName,
			action: "user.create",
			entityType: "user",
			entityId: created.id,
			summary: `Created local user ${input.username}`,
			changes: {
				to: {
					username: input.username,
					admin: input.admin ?? false,
					mustChangePassword: input.mustChangePassword ?? false,
				},
			},
		});
		return { action: "created", active: true };
	});
}

type BootstrapConfig = { username?: string; password?: string };

/** Creates the administrator from BOOTSTRAP_ADMIN_*, only while no administrator exists. */
export async function bootstrapAdmin(
	config: BootstrapConfig = {
		username: env.BOOTSTRAP_ADMIN_USERNAME,
		password: env.BOOTSTRAP_ADMIN_PASSWORD,
	},
	database: Executor = db,
): Promise<"created" | "skipped"> {
	const { username, password } = config;
	if (!username && !password) return "skipped";
	if (!username || !password) {
		console.warn(
			"bootstrap administrator skipped: set both BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD",
		);
		return "skipped";
	}

	const created = await database.transaction(async (tx) => {
		const [admin] = await tx
			.select({ id: users.id })
			.from(users)
			.where(eq(users.isAdmin, true))
			.limit(1);
		if (admin) return false;

		const problem =
			validateUsername(username) ?? validatePassword(password, username);
		if (problem) {
			throw new Error(
				`BOOTSTRAP_ADMIN_USERNAME or BOOTSTRAP_ADMIN_PASSWORD is not usable: ${problem}`,
			);
		}
		const passwordHash = await hashPassword(password);

		await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`);
		const [raced] = await tx
			.select({ id: users.id })
			.from(users)
			.where(eq(users.isAdmin, true))
			.limit(1);
		if (raced) return false;

		try {
			await saveLocalUser(tx, {
				username,
				password,
				passwordHash,
				admin: true,
				mustChangePassword: true,
				createOnly: true,
				actorName: "system",
			});
		} catch (error) {
			if (error instanceof InvalidUserInput) {
				throw new Error(
					`BOOTSTRAP_ADMIN_USERNAME or BOOTSTRAP_ADMIN_PASSWORD is not usable: ${error.message}`,
					{ cause: error },
				);
			}
			throw new Error(
				`bootstrap administrator could not be created: ${safeMessage(error)}`,
				{ cause: error },
			);
		}
		return true;
	});

	console.log(
		created
			? `bootstrap administrator created: ${username}`
			: "bootstrap administrator skipped: an administrator already exists",
	);
	return created ? "created" : "skipped";
}
