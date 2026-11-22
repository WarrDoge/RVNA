import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
	bootstrapAdmin,
	InvalidUserInput,
	saveLocalUser,
} from "../src/lib/server/bootstrap.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { hashPassword, verifyPassword } from "../src/lib/server/passwords.ts";
import { apiTokens, sessions, users } from "../src/lib/server/schema.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import { cleanupTestData, swapTransaction } from "./helpers.ts";

const run = newRun();
const name = (label: string) => `t-${run}-${label}`;
const password = "bootstrap passphrase 77";
const root = fileURLToPath(new URL("..", import.meta.url));

class Rollback extends Error {}

/** Runs `body` in a transaction in which no administrator exists, then rolls it back. */
async function withoutAdmins(
	body: (
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	) => Promise<void>,
) {
	await expect(
		db.transaction(async (tx) => {
			await tx
				.update(users)
				.set({ isAdmin: false })
				.where(eq(users.isAdmin, true));
			await body(tx);
			throw new Rollback();
		}),
	).rejects.toThrow(Rollback);
}

beforeAll(runMigrations);

afterAll(async () => {
	await pool.query("delete from audit_log where summary ilike $1", [
		`%${run}%`,
	]);
	await cleanupTestData(run);
	await pool.end();
});

test("creates the administrator, with a forced password change, only while none exists", async () => {
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		await withoutAdmins(async (tx) => {
			const username = name("boot");
			const config = { username, password };
			expect(await bootstrapAdmin(config, tx)).toBe("created");

			const [row] = await tx
				.select()
				.from(users)
				.where(eq(users.username, username));
			expect(row.isAdmin).toBe(true);
			expect(row.adminLocal).toBe(true);
			expect(row.mustChangePassword).toBe(true);
			expect((await verifyPassword(password, row.passwordHash)).ok).toBe(true);

			const { rows } = await tx.execute(
				`select actor_name, actor_id, action from audit_log where entity_id = '${row.id}'`,
			);
			expect(rows).toEqual([
				{ actor_name: "system", actor_id: null, action: "user.create" },
			]);

			expect(
				await bootstrapAdmin({ username: name("boot2"), password }, tx),
			).toBe("skipped");
			const second = await tx
				.select()
				.from(users)
				.where(eq(users.username, name("boot2")));
			expect(second).toHaveLength(0);
		});
		const lines = log.mock.calls.map((call) => String(call[0]));
		expect(lines[0]).toBe(`bootstrap administrator created: ${name("boot")}`);
		expect(lines).toHaveLength(2);
		expect(lines.join("\n")).not.toContain(password);
	} finally {
		log.mockRestore();
	}
});

test("does nothing when an administrator already exists or nothing is configured", async () => {
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		await makeUser(run, "existing-admin", { admin: true });
		const username = name("never");
		expect(await bootstrapAdmin({ username, password })).toBe("skipped");
		expect(
			await db.select().from(users).where(eq(users.username, username)),
		).toHaveLength(0);
		expect(await bootstrapAdmin({})).toBe("skipped");
		expect(
			await bootstrapAdmin({ username: name("never2"), password: "short" }),
		).toBe("skipped");
	} finally {
		log.mockRestore();
	}
});

test("an unusable password or a taken username stops the start without leaking the password", async () => {
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		await withoutAdmins(async (tx) => {
			await expect(
				bootstrapAdmin({ username: name("weak"), password: "short" }, tx),
			).rejects.toThrow(/at least 12 characters/);

			await expect(
				bootstrapAdmin(
					{ username: name("weak"), password: "administrator" },
					tx,
				),
			).rejects.toThrow(/too common/);

			await makeUser(run, "taken");
			const error = await bootstrapAdmin(
				{ username: name("TAKEN"), password },
				tx,
			).catch((caught: Error) => caught);
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toMatch(/already exists/);
			expect((error as Error).message).not.toContain(password);
		});
	} finally {
		log.mockRestore();
	}
});

test("concurrent creates of one name in two spellings make one account", async () => {
	const username = name("race");
	const original = db.transaction.bind(db);
	let entered = 0;
	let release = () => {};
	let bothEntered = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const both = new Promise<void>((resolve) => {
		bothEntered = resolve;
	});
	const restore = swapTransaction(async (callback) => {
		entered += 1;
		if (entered === 2) bothEntered();
		await gate;
		return original(callback);
	});
	const fn = `user_delay_${run}`;
	await pool.query(`drop trigger if exists ${fn} on users`);
	await pool.query(`drop function if exists ${fn}()`);
	await pool.query(
		`create function ${fn}() returns trigger language plpgsql as $$ begin perform pg_sleep(0.4); return new; end $$`,
	);
	await pool.query(
		`create trigger ${fn} before insert on users for each row when (lower(new.username) = '${username.toLowerCase()}') execute function ${fn}()`,
	);
	try {
		const first = saveLocalUser(db, {
			username,
			password,
			actorName: "test",
		});
		const second = saveLocalUser(db, {
			username: username.toUpperCase(),
			password,
			actorName: "test",
		});
		await both;
		restore();
		release();
		await Promise.all([first, second]);

		const rows = await db
			.select()
			.from(users)
			.where(sql`lower(${users.username}) = ${username.toLowerCase()}`);
		expect(rows).toHaveLength(1);
	} finally {
		restore();
		await pool.query(`drop trigger if exists ${fn} on users`);
		await pool.query(`drop function if exists ${fn}()`);
		await db
			.delete(users)
			.where(sql`lower(${users.username}) = ${username.toLowerCase()}`);
	}
});

test("a local password cannot be set on an account that signs in with SSO", async () => {
	const username = name("sso");
	const [existing] = await db
		.insert(users)
		.values({
			username,
			displayName: `SSO ${run}`,
			oidcSub: `sub-${username}`,
		})
		.returning();
	try {
		await expect(
			saveLocalUser(db, { username, password, actorName: "test" }),
		).rejects.toBeInstanceOf(InvalidUserInput);
		const [after] = await db
			.select()
			.from(users)
			.where(eq(users.id, existing.id));
		expect(after.passwordHash).toBeNull();
	} finally {
		await db.delete(users).where(eq(users.id, existing.id));
	}
});

test("saveLocalUser validates an email and lets an empty address clear it", async () => {
	const username = name("email");
	const invalid = await db
		.transaction(async (tx) => {
			await saveLocalUser(tx, {
				username,
				password,
				email: "not-an-address",
				actorName: "test",
			});
			throw new Rollback();
		})
		.catch((error: unknown) => error);
	expect(invalid).toBeInstanceOf(InvalidUserInput);
	expect((invalid as Error).message).toContain("valid email");

	await expect(
		db.transaction(async (tx) => {
			await saveLocalUser(tx, {
				username,
				password,
				email: `${username}@example.test`,
				actorName: "test",
			});
			await saveLocalUser(tx, {
				username,
				password,
				email: "",
				actorName: "test",
			});
			const [row] = await tx
				.select()
				.from(users)
				.where(eq(users.username, username));
			expect(row.email).toBeNull();
			throw new Rollback();
		}),
	).rejects.toThrow(Rollback);
});

test("a partially configured bootstrap warns and skips", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		expect(await bootstrapAdmin({ username: name("partial") })).toBe("skipped");
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("BOOTSTRAP_ADMIN_PASSWORD"),
		);
	} finally {
		warn.mockRestore();
	}
});

test("saveLocalUser can use a hash computed before its transaction", async () => {
	const username = name("hash");
	const passwordHash = await hashPassword(password);
	await expect(
		db.transaction(async (tx) => {
			await saveLocalUser(tx, {
				username,
				password,
				passwordHash,
				actorName: "test",
			});
			const [row] = await tx
				.select()
				.from(users)
				.where(eq(users.username, username));
			expect(row.passwordHash).toBe(passwordHash);
			expect((await verifyPassword(password, row.passwordHash)).ok).toBe(true);
			throw new Rollback();
		}),
	).rejects.toThrow(Rollback);
});

test("a driver failure keeps its cause in the bootstrap error", async () => {
	const driverError = new Error("driver exploded");
	const chain = {
		from: () => chain,
		where: () => chain,
		for: () => chain,
		limit: () => Promise.resolve([]),
	};
	const tx: {
		execute: () => Promise<undefined>;
		select: (...args: unknown[]) => typeof chain;
		insert: (...args: unknown[]) => never;
		transaction: (
			callback: (value: unknown) => Promise<unknown>,
		) => Promise<unknown>;
	} = {
		execute: async () => undefined,
		select: () => chain,
		insert: () => {
			throw driverError;
		},
		transaction: async (callback) => callback(tx),
	};
	const database = {
		transaction: async (callback: (value: typeof tx) => Promise<unknown>) =>
			callback(tx),
	};
	const error = await bootstrapAdmin(
		{ username: name("cause"), password },
		database as unknown as Parameters<typeof bootstrapAdmin>[1],
	).catch((caught: unknown) => caught);
	expect(error).toBeInstanceOf(Error);
	expect((error as Error).message).toContain("driver exploded");
	expect((error as Error).cause).toBe(driverError);
});

function cli(args: string[], stdin?: string) {
	return new Promise<{ code: number | null; stdout: string; stderr: string }>(
		(resolve) => {
			const child = spawn(
				process.execPath,
				["src/lib/server/user-create.ts", ...args],
				{
					cwd: root,
					env: {
						PATH: process.env.PATH,
						DATABASE_URL: process.env.DATABASE_URL,
					},
					stdio: ["pipe", "pipe", "pipe"],
				},
			);
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk) => {
				stdout += chunk;
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			child.on("close", (code) => resolve({ code, stdout, stderr }));
			child.stdin.end(stdin ?? "");
		},
	);
}

test("user:create makes a local administrator, then changes its password", async () => {
	const username = name("cli");
	const created = await cli(
		[
			"--username",
			username,
			"--admin",
			"--name",
			`CLI ${run}`,
			"--email",
			`${username}@example.test`,
			"--password-stdin",
		],
		`${password}\n`,
	);
	expect(created).toMatchObject({
		code: 0,
		stdout: `created user ${username}\n`,
		stderr: "",
	});

	const [row] = await db
		.select()
		.from(users)
		.where(eq(users.username, username));
	expect(row.isAdmin).toBe(true);
	expect(row.adminLocal).toBe(true);
	expect(row.mustChangePassword).toBe(false);
	expect(row.displayName).toBe(`CLI ${run}`);
	expect((await verifyPassword(password, row.passwordHash)).ok).toBe(true);

	await makeUserSession(row.id);
	await db.insert(apiTokens).values({
		userId: row.id,
		name: "cli token",
		tokenHash: `cli-${run}`,
	});
	const next = "a different passphrase 88";
	const updated = await cli(
		["--username", username.toUpperCase(), "--must-change", "--password-stdin"],
		`${next}\r\n`,
	);
	expect(updated).toMatchObject({
		code: 0,
		stdout: `updated user ${username.toUpperCase()}\n`,
	});

	const [after] = await db.select().from(users).where(eq(users.id, row.id));
	expect((await verifyPassword(next, after.passwordHash)).ok).toBe(true);
	expect(after.mustChangePassword).toBe(true);
	expect(after.isAdmin).toBe(true);
	expect(
		await db.select().from(sessions).where(eq(sessions.userId, row.id)),
	).toHaveLength(0);
	expect(
		await db.select().from(apiTokens).where(eq(apiTokens.userId, row.id)),
	).toHaveLength(0);
	const { rows: audits } = await pool.query<{
		changes: { to?: { apiTokensRevoked?: number } };
	}>(
		"select changes from audit_log where entity_id = $1 and action = 'user.update'",
		[row.id],
	);
	expect(audits).toHaveLength(1);
	expect(audits[0]?.changes).toMatchObject({
		to: { apiTokensRevoked: 1 },
	});

	const everything =
		created.stdout + created.stderr + updated.stdout + updated.stderr;
	expect(everything).not.toContain(password);
	expect(everything).not.toContain(next);
}, 60_000);

async function makeUserSession(userId: string) {
	const { createSession } = await import("../src/lib/server/auth.ts");
	await createSession(userId, null);
}

test("user:create rejects bad input with a clear message and exit code 1", async () => {
	const weak = await cli(
		["--username", name("clibad"), "--password-stdin"],
		"short\n",
	);
	expect(weak.code).toBe(1);
	expect(weak.stderr).toContain("at least 12 characters");
	expect(weak.stderr).not.toContain("short\n");

	const noSource = await cli(["--username", name("clibad")]);
	expect(noSource.code).toBe(1);
	expect(noSource.stderr).toContain("--password-stdin");

	const argument = await cli([
		"--username",
		name("clibad"),
		"--password",
		password,
	]);
	expect(argument.code).toBe(1);
	expect(argument.stderr).not.toContain(password);

	const noName = await cli(["--password-stdin"], `${password}\n`);
	expect(noName.code).toBe(1);
	expect(noName.stderr).toContain("Usage");

	const empty = await db
		.select()
		.from(users)
		.where(eq(users.username, name("clibad")));
	expect(empty).toHaveLength(0);
}, 60_000);
