import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256 } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { parseEnv } from "../src/lib/server/env.ts";
import {
	hashParameters,
	hashPassword,
	verifyPassword,
} from "../src/lib/server/passwords.ts";
import { apiTokens, users } from "../src/lib/server/schema.ts";
import { injectAs, makeUser, newRun } from "./admin-helpers.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const name = (label: string) => `t-${run}-${label}`;
const password = "correct horse staple 42";
const root = fileURLToPath(new URL("..", import.meta.url));
const ipBase = `203.0.${Number.parseInt(run.slice(0, 2), 16)}`;
const usedIps = new Set<string>();
let ipCounter = 0;
let app: TestApp;
let hash: string;
const children: ChildProcess[] = [];

function nextIp() {
	const ip = `${ipBase}.${(ipCounter++ % 250) + 1}`;
	usedIps.add(ip);
	return ip;
}

async function makePasswordUser(
	label: string,
	options: {
		active?: boolean;
		email?: string;
		mustChange?: boolean;
		passwordHash?: string | null;
	} = {},
) {
	const username = name(label);
	const [row] = await db
		.insert(users)
		.values({
			username,
			displayName: `Local ${label} ${run}`,
			email: options.email ?? `${username}@example.test`,
			active: options.active ?? true,
			mustChangePassword: options.mustChange ?? false,
			passwordHash:
				options.passwordHash === undefined ? hash : options.passwordHash,
		})
		.returning();
	return row;
}

async function attempt(
	body: { username: string; password: string; returnTo?: string },
	options: { ip?: string; headers?: Record<string, string> } = {},
) {
	const response = await app.inject({
		method: "POST",
		url: "/auth/local",
		remoteAddress: options.ip ?? nextIp(),
		headers: { "x-requested-with": "rvna", ...options.headers },
		payload: body,
	});
	expect(response.body).not.toContain("$argon2");
	return response;
}

function sidFrom(response: { headers: Record<string, unknown> }) {
	const header = response.headers["set-cookie"];
	const values = Array.isArray(header) ? header.map(String) : [String(header)];
	const sid = values.find((value) => value.startsWith("sid="));
	return sid?.split(";")[0]?.slice(4);
}

const userKey = (username: string, ip: string) =>
	`${username.toLowerCase()}|${ip}`;

async function throttleRow(kind: "user" | "ip", key: string) {
	const { rows } = await pool.query(
		"select failures, last_failure_at, locked_until from login_throttle where kind = $1 and key = $2",
		[kind, key],
	);
	return rows[0] as
		| { failures: number; last_failure_at: Date; locked_until: Date | null }
		| undefined;
}

async function setThrottle(
	kind: "user" | "ip",
	key: string,
	state: { failures: number; ageSeconds?: number; lockedInSeconds?: number },
) {
	await pool.query(
		`insert into login_throttle (kind, key, failures, last_failure_at, locked_until)
		 values ($1, $2, $3, now() - make_interval(secs => $4), case when $5::float8 is null then null else now() + make_interval(secs => $5) end)
		 on conflict (kind, key) do update set failures = excluded.failures,
			last_failure_at = excluded.last_failure_at, locked_until = excluded.locked_until`,
		[
			kind,
			key,
			state.failures,
			state.ageSeconds ?? 0,
			state.lockedInSeconds ?? null,
		],
	);
}

async function freePort() {
	return new Promise<number>((resolve) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

async function startServer(extraEnv: Record<string, string>) {
	const port = await freePort();
	const output: string[] = [];
	const child = spawn(process.execPath, ["build"], {
		cwd: root,
		env: {
			PATH: process.env.PATH,
			DATABASE_URL: process.env.DATABASE_URL,
			PORT: String(port),
			APP_URL: `http://127.0.0.1:${port}`,
			ORIGIN: `http://127.0.0.1:${port}`,
			BODY_SIZE_LIMIT: "Infinity",
			NODE_ENV: "test",
			...extraEnv,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	child.stdout?.on("data", (chunk) => output.push(String(chunk)));
	child.stderr?.on("data", (chunk) => output.push(String(chunk)));
	let exited = false;
	child.once("exit", () => {
		exited = true;
	});

	const base = `http://127.0.0.1:${port}`;
	for (let waited = 0; waited < 30_000; waited += 200) {
		if (exited) throw new Error(`server exited early:\n${output.join("")}`);
		try {
			const response = await fetch(`${base}/api/health`);
			if (response.ok) return { base, output };
		} catch {
			// not listening yet
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`server did not start:\n${output.join("")}`);
}

beforeAll(async () => {
	await runMigrations();
	hash = await hashPassword(password);
	app = buildServer();
});

afterAll(async () => {
	for (const child of children) child.kill("SIGTERM");
	await Promise.all(
		children.map(
			(child) =>
				new Promise((resolve) => {
					if (child.exitCode !== null) resolve(null);
					else child.once("exit", resolve);
				}),
		),
	);
	await pool.query(
		"delete from login_throttle where key like $1 or key = any($2)",
		[`t-${run}-%`, [...usedIps]],
	);
	await pool.query(
		"delete from audit_log where actor_name ilike $1 or summary ilike $1",
		[`%${run}%`],
	);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

describe("environment", () => {
	const base = { DATABASE_URL: "postgres://u:p@localhost/db" };

	test("no OIDC and no dev login is a valid configuration", () => {
		const parsed = parseEnv(base);
		expect(parsed.SSO_AUTO_REDIRECT).toBe(false);
		expect(parsed.OIDC_ISSUER).toBeUndefined();
	});

	test("the OIDC values must be set together", () => {
		expect(() => parseEnv({ ...base, OIDC_CLIENT_ID: "x" })).toThrow(
			/must be set together/,
		);
	});

	test("DEV_LOGIN_USER is refused in production", () => {
		expect(() =>
			parseEnv({ ...base, NODE_ENV: "production", DEV_LOGIN_USER: "dev" }),
		).toThrow(/DEV_LOGIN_USER/);
	});

	test("DEV_LOGIN_USER needs an APP_URL on localhost, whatever NODE_ENV says", () => {
		for (const APP_URL of [
			"https://tracker.example.org",
			"http://10.0.0.5:3000",
			"http://localhost.example.org",
		]) {
			expect(() =>
				parseEnv({ ...base, APP_URL, DEV_LOGIN_USER: "dev" }),
			).toThrow(/DEV_LOGIN_USER/);
		}
		for (const APP_URL of [
			undefined,
			"http://localhost:3000",
			"http://127.0.0.1:4960",
			"http://[::1]:3000",
		]) {
			expect(
				parseEnv({
					...base,
					...(APP_URL ? { APP_URL } : {}),
					DEV_LOGIN_USER: "dev",
				}).DEV_LOGIN_USER,
			).toBe("dev");
		}
	});

	test("booleans and the bootstrap pair", () => {
		expect(
			parseEnv({ ...base, SSO_AUTO_REDIRECT: "true" }).SSO_AUTO_REDIRECT,
		).toBe(true);
		expect(() =>
			parseEnv({ ...base, BOOTSTRAP_ADMIN_USERNAME: "admin" }),
		).toThrow(/must be set together/);
	});
});

describe("passwords", () => {
	test("hash and verify round trip, with the parameters inside the hash", async () => {
		expect(hash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
		expect(await verifyPassword(password, hash)).toEqual({
			ok: true,
			needsRehash: false,
		});
		expect((await verifyPassword("wrong password 123", hash)).ok).toBe(false);
		expect((await verifyPassword(password, null)).ok).toBe(false);
	});

	test("raised parameters report needsRehash and the next login upgrades the hash", async () => {
		const original = { ...hashParameters };
		hashParameters.memory = 8192;
		hashParameters.passes = 1;
		const weak = await hashPassword(password);
		Object.assign(hashParameters, original);

		expect(await verifyPassword(password, weak)).toEqual({
			ok: true,
			needsRehash: true,
		});

		const user = await makePasswordUser("rehash", { passwordHash: weak });
		const response = await attempt({ username: user.username, password });
		expect(response.statusCode).toBe(200);

		const [row] = await db.select().from(users).where(eq(users.id, user.id));
		expect(row.passwordHash).not.toBe(weak);
		expect(row.passwordHash).toContain(
			`m=${original.memory},t=${original.passes}`,
		);
		expect((await verifyPassword(password, row.passwordHash)).needsRehash).toBe(
			false,
		);
	});
});

describe("POST /auth/local", () => {
	test("logs in by username or email, any case, and sets the session cookie", async () => {
		const user = await makePasswordUser("alice");
		const byName = await attempt({
			username: user.username.toUpperCase(),
			password,
			returnTo: "/browse/ABC-1?a=b",
		});
		expect(byName.statusCode).toBe(200);
		expect(byName.json()).toEqual({
			redirect: "/browse/ABC-1?a=b",
			mustChangePassword: false,
		});
		const cookie = String(byName.headers["set-cookie"]);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");

		const byEmail = await attempt({
			username: ` ${user.email?.toUpperCase()} `,
			password,
		});
		expect(byEmail.statusCode).toBe(200);
		expect(byEmail.json().redirect).toBe("/");

		const me = await app.inject({
			method: "GET",
			url: "/api/me",
			cookies: { sid: sidFrom(byName) as string },
		});
		expect(me.statusCode).toBe(200);
		expect(me.json()).toMatchObject({
			username: user.username,
			hasPassword: true,
			mustChangePassword: false,
		});
		expect(me.body).not.toContain("$argon2");

		const list = await injectAs(
			app,
			sidFrom(byName) as string,
			"GET",
			"/api/users",
		);
		expect(list.body).not.toContain("$argon2");
	});

	test("records last_login_at and audits success and failure", async () => {
		const user = await makePasswordUser("audit");
		expect(user.lastLoginAt).toBeNull();
		const ip = nextIp();

		await attempt(
			{ username: user.username, password: "wrong password 12" },
			{ ip },
		);
		const ok = await attempt({ username: user.username, password }, { ip });
		expect(ok.statusCode).toBe(200);

		const [row] = await db.select().from(users).where(eq(users.id, user.id));
		expect(row.lastLoginAt).toBeInstanceOf(Date);

		const { rows } = await pool.query(
			"select action, actor_id, actor_name, summary from audit_log where actor_name = $1 or actor_id = $2 order by created_at",
			[user.username, user.id],
		);
		const failure = rows.find((entry) => entry.action === "login.failure");
		const success = rows.find((entry) => entry.action === "login.success");
		expect(failure.actor_id).toBeNull();
		expect(failure.summary).toContain(ip);
		expect(failure.summary).not.toContain("wrong password");
		expect(success.actor_id).toBe(user.id);
		expect(JSON.stringify(rows)).not.toContain(password);
	});

	test("every failure cause gives the same status and body", async () => {
		const shared = `${name("shared")}@example.test`;
		await makePasswordUser("dup1", { email: shared });
		await makePasswordUser("dup2", { email: shared });
		const known = await makePasswordUser("known");
		const inactive = await makePasswordUser("inactive", { active: false });
		const ssoOnly = await makePasswordUser("ssoonly", { passwordHash: null });

		const causes = [
			{ username: known.username, password: "wrong password 123" },
			{ username: name("nobody"), password },
			{ username: inactive.username, password },
			{ username: ssoOnly.username, password },
			{ username: shared, password },
		];
		const responses = [];
		for (const cause of causes) responses.push(await attempt(cause));

		for (const response of responses) {
			expect(response.statusCode).toBe(401);
			expect(response.json()).toEqual({
				error: "Incorrect username or password",
			});
			expect(response.headers["set-cookie"]).toBeUndefined();
		}
	});

	test("requires the X-Requested-With header, with or without a session cookie", async () => {
		const user = await makePasswordUser("csrf");
		const anonymous = await app.inject({
			method: "POST",
			url: "/auth/local",
			payload: { username: user.username, password },
		});
		expect(anonymous.statusCode).toBe(403);
		expect(anonymous.headers["set-cookie"]).toBeUndefined();

		const empty = await app.inject({ method: "POST", url: "/auth/local" });
		expect(empty.statusCode).toBe(403);

		const withCookie = await app.inject({
			method: "POST",
			url: "/auth/local",
			cookies: { sid: "whatever" },
			payload: { username: user.username, password },
		});
		expect(withCookie.statusCode).toBe(403);

		const encoded = await app.inject({
			method: "POST",
			url: "/%61uth/local",
			payload: { username: user.username, password },
		});
		expect(encoded.statusCode).toBe(403);
	});

	test("returnTo that could leave the site falls back to /", async () => {
		const user = await makePasswordUser("return");
		for (const returnTo of [
			"//evil.example",
			"/\\evil.example",
			"https://evil.example",
			"/\t/evil.example",
			"/ok\nevil",
			"evil",
		]) {
			const response = await attempt({
				username: user.username,
				password,
				returnTo,
			});
			expect(response.statusCode).toBe(200);
			expect(response.json().redirect).toBe("/");
		}
	});

	test("a login replaces the session cookie it was sent with", async () => {
		const user = await makePasswordUser("fixation");
		const first = await attempt({ username: user.username, password });
		const old = sidFrom(first) as string;
		const second = await attempt(
			{ username: user.username, password },
			{ headers: { cookie: `sid=${old}` } },
		);
		expect(second.statusCode).toBe(200);
		const stale = await app.inject({
			method: "GET",
			url: "/api/me",
			cookies: { sid: old },
		});
		expect(stale.statusCode).toBe(401);
	});

	test("a malformed body is a 400 and never a 500", async () => {
		const response = await attempt({ username: "", password: "" });
		expect(response.statusCode).toBe(400);
	});
});

describe("throttling", () => {
	test("five failures start a delay, and a delayed attempt is not verified", async () => {
		const user = await makePasswordUser("delay");
		const ip = nextIp();
		for (let index = 0; index < 5; index++) {
			const response = await attempt(
				{ username: user.username, password: "wrong password 123" },
				{ ip },
			);
			expect(response.statusCode).toBe(401);
		}
		expect(
			(await throttleRow("user", userKey(user.username, ip)))?.failures,
		).toBe(5);

		const delayed = await attempt(
			{ username: user.username, password },
			{ ip },
		);
		expect(delayed.statusCode).toBe(429);
		expect(delayed.json()).toEqual({ error: "Too many failed attempts" });
		expect(Number(delayed.headers["retry-after"])).toBeGreaterThanOrEqual(1);
		expect(Number(delayed.headers["retry-after"])).toBeLessThanOrEqual(2);
		expect(delayed.headers["set-cookie"]).toBeUndefined();
		expect(
			(await throttleRow("user", userKey(user.username, ip)))?.failures,
		).toBe(5);

		const { rows } = await pool.query(
			"select summary from audit_log where action = 'login.locked' and actor_name = $1",
			[user.username],
		);
		expect(rows).toHaveLength(1);
	});

	test("the delay doubles with each failure and ends when it has passed", async () => {
		const user = await makePasswordUser("grow");
		const ip = nextIp();
		const key = userKey(user.username, ip);

		await setThrottle("user", key, { failures: 7, ageSeconds: 0 });
		const wait = await attempt({ username: user.username, password }, { ip });
		expect(wait.statusCode).toBe(429);
		expect(Number(wait.headers["retry-after"])).toBeGreaterThanOrEqual(7);
		expect(Number(wait.headers["retry-after"])).toBeLessThanOrEqual(8);

		await setThrottle("user", key, { failures: 7, ageSeconds: 9 });
		const through = await attempt(
			{ username: user.username, password },
			{ ip },
		);
		expect(through.statusCode).toBe(200);
		expect(await throttleRow("user", key)).toBeUndefined();
	});

	test("ten failures lock the key for 15 minutes, even for the right password", async () => {
		const user = await makePasswordUser("lock");
		const ip = nextIp();
		const key = userKey(user.username, ip);

		await setThrottle("user", key, { failures: 9, ageSeconds: 60 });
		const tenth = await attempt(
			{ username: user.username, password: "wrong password 123" },
			{ ip },
		);
		expect(tenth.statusCode).toBe(401);
		const row = await throttleRow("user", key);
		expect(row?.failures).toBe(10);
		const lockSeconds =
			((row?.locked_until?.getTime() ?? 0) - Date.now()) / 1000;
		expect(lockSeconds).toBeGreaterThan(14 * 60);
		expect(lockSeconds).toBeLessThanOrEqual(15 * 60);

		const locked = await attempt({ username: user.username, password }, { ip });
		expect(locked.statusCode).toBe(429);
		expect(Number(locked.headers["retry-after"])).toBeGreaterThan(14 * 60);
		expect(locked.headers["set-cookie"]).toBeUndefined();
		expect((await throttleRow("user", key))?.failures).toBe(10);
	});

	test("a lock on one address leaves the same name usable from another", async () => {
		const user = await makePasswordUser("pairlock");
		const attacker = nextIp();
		const owner = nextIp();
		const key = userKey(user.username, attacker);

		await setThrottle("user", key, { failures: 9, ageSeconds: 60 });
		const tenth = await attempt(
			{ username: user.username, password: "wrong password 123" },
			{ ip: attacker },
		);
		expect(tenth.statusCode).toBe(401);
		const row = await throttleRow("user", key);
		expect(row?.failures).toBe(10);
		expect(row?.locked_until).not.toBeNull();

		const locked = await attempt(
			{ username: user.username, password },
			{ ip: attacker },
		);
		expect(locked.statusCode).toBe(429);
		const other = await attempt(
			{ username: user.username, password },
			{ ip: owner },
		);
		expect(other.statusCode).toBe(200);
	});

	test("the lock looks the same for a name that does not exist", async () => {
		const real = await makePasswordUser("lockreal");
		const ghost = name("lockghost");
		const realIp = nextIp();
		const ghostIp = nextIp();
		for (const [typed, ip] of [
			[real.username, realIp],
			[ghost, ghostIp],
		] as const) {
			await setThrottle("user", userKey(typed, ip), {
				failures: 10,
				ageSeconds: 0,
				lockedInSeconds: 900,
			});
		}
		const [a, b] = await Promise.all([
			attempt(
				{ username: real.username, password: "wrong password 123" },
				{ ip: realIp },
			),
			attempt(
				{ username: ghost, password: "wrong password 123" },
				{ ip: ghostIp },
			),
		]);
		expect(a.statusCode).toBe(429);
		expect(b.statusCode).toBe(429);
		expect(a.json()).toEqual(b.json());
		expect(a.headers["retry-after"]).toBeDefined();
		expect(b.headers["retry-after"]).toBeDefined();
	});

	test("counters reset after an expired lock or an hour without failures", async () => {
		const expired = await makePasswordUser("expired");
		const expiredIp = nextIp();
		const expiredKey = userKey(expired.username, expiredIp);
		await setThrottle("user", expiredKey, {
			failures: 10,
			ageSeconds: 1000,
			lockedInSeconds: -1,
		});
		const first = await attempt(
			{ username: expired.username, password: "wrong password 123" },
			{ ip: expiredIp },
		);
		expect(first.statusCode).toBe(401);
		expect((await throttleRow("user", expiredKey))?.failures).toBe(1);

		const stale = await makePasswordUser("stale");
		const staleIp = nextIp();
		const staleKey = userKey(stale.username, staleIp);
		await setThrottle("user", staleKey, { failures: 8, ageSeconds: 3700 });
		const second = await attempt(
			{ username: stale.username, password: "wrong password 123" },
			{ ip: staleIp },
		);
		expect(second.statusCode).toBe(401);
		expect((await throttleRow("user", staleKey))?.failures).toBe(1);
	});

	test("a success clears the user and IP counters", async () => {
		const user = await makePasswordUser("clear");
		const ip = nextIp();
		const key = userKey(user.username, ip);
		await attempt(
			{ username: user.username, password: "wrong password 123" },
			{ ip },
		);
		await attempt(
			{ username: user.username, password: "wrong password 123" },
			{ ip },
		);
		expect((await throttleRow("user", key))?.failures).toBe(2);
		expect((await throttleRow("ip", ip))?.failures).toBe(2);

		const ok = await attempt({ username: user.username, password }, { ip });
		expect(ok.statusCode).toBe(200);
		expect(await throttleRow("user", key)).toBeUndefined();
		expect(await throttleRow("ip", ip)).toBeUndefined();
	});

	test("the per-IP counter has five times the thresholds and blocks every name", async () => {
		const user = await makePasswordUser("ip");
		const ip = nextIp();

		for (let index = 0; index < 5; index++) {
			await attempt({ username: name(`spray${index}`), password }, { ip });
		}
		expect((await throttleRow("ip", ip))?.failures).toBe(5);
		const stillFine = await attempt(
			{ username: user.username, password },
			{ ip },
		);
		expect(stillFine.statusCode).toBe(200);

		await setThrottle("ip", ip, { failures: 25, ageSeconds: 0 });
		const delayed = await attempt(
			{ username: user.username, password },
			{ ip },
		);
		expect(delayed.statusCode).toBe(429);
		expect(Number(delayed.headers["retry-after"])).toBeLessThanOrEqual(2);

		await setThrottle("ip", ip, {
			failures: 50,
			ageSeconds: 0,
			lockedInSeconds: 900,
		});
		const locked = await attempt({ username: user.username, password }, { ip });
		expect(locked.statusCode).toBe(429);
		expect(Number(locked.headers["retry-after"])).toBeGreaterThan(14 * 60);

		const otherIp = await attempt({ username: user.username, password });
		expect(otherIp.statusCode).toBe(200);
	});

	test("parallel attempts cannot slip past the limit", async () => {
		const user = await makePasswordUser("burst");
		const ip = nextIp();
		const responses = await Promise.all(
			Array.from({ length: 12 }, () =>
				attempt(
					{ username: user.username, password: "wrong password 123" },
					{ ip },
				),
			),
		);
		const statuses = responses.map((response) => response.statusCode);
		expect(
			statuses.filter((status) => status === 401).length,
		).toBeLessThanOrEqual(5);
		expect(statuses.every((status) => status === 401 || status === 429)).toBe(
			true,
		);
	});

	test("X-Forwarded-For is ignored unless ADDRESS_HEADER is set", async () => {
		const user = await makePasswordUser("proxy");
		const ip = nextIp();
		await attempt(
			{ username: user.username, password: "wrong password 123" },
			{ ip, headers: { "x-forwarded-for": "203.0.113.9" } },
		);
		expect((await throttleRow("ip", ip))?.failures).toBe(1);
		expect(await throttleRow("ip", "203.0.113.9")).toBeUndefined();
	});
});

describe("password change", () => {
	test("needs the current password, ends other sessions, keeps this one", async () => {
		const user = await makePasswordUser("change");
		const first = sidFrom(
			await attempt({ username: user.username, password }),
		) as string;
		const second = sidFrom(
			await attempt({ username: user.username, password }),
		) as string;
		const key = userKey(user.username, "127.0.0.1");
		const newPassword = "another long passphrase 99";

		const wrong = await injectAs(app, first, "POST", "/api/me/password", {
			currentPassword: "not the password 1",
			newPassword,
		});
		expect(wrong.statusCode).toBe(400);
		expect(wrong.json()).toEqual({
			error: "The current password is incorrect",
		});
		expect((await throttleRow("user", key))?.failures).toBe(1);

		const weak = await injectAs(app, first, "POST", "/api/me/password", {
			currentPassword: password,
			newPassword: "short",
		});
		expect(weak.statusCode).toBe(400);
		expect(weak.json().error).toMatch(/at least 12/);

		const same = await injectAs(app, first, "POST", "/api/me/password", {
			currentPassword: password,
			newPassword: password,
		});
		expect(same.statusCode).toBe(400);

		const noHeader = await app.inject({
			method: "POST",
			url: "/api/me/password",
			cookies: { sid: first },
			payload: { currentPassword: password, newPassword },
		});
		expect(noHeader.statusCode).toBe(403);

		const token = `rvna_${run}_change`;
		await db.insert(apiTokens).values({
			userId: user.id,
			name: `change token ${run}`,
			tokenHash: sha256(token),
		});
		const bearerBefore = await app.inject({
			method: "GET",
			url: "/api/me",
			headers: { authorization: `Bearer ${token}` },
		});
		expect(bearerBefore.statusCode).toBe(200);

		const changed = await injectAs(app, first, "POST", "/api/me/password", {
			currentPassword: password,
			newPassword,
		});
		expect(changed.statusCode).toBe(204);
		expect(changed.body).toBe("");

		const bearer = await app.inject({
			method: "GET",
			url: "/api/me",
			headers: { authorization: `Bearer ${token}` },
		});
		expect(bearer.statusCode).toBe(401);
		expect(
			await db.select().from(apiTokens).where(eq(apiTokens.userId, user.id)),
		).toEqual([]);

		const alive = await app.inject({
			method: "GET",
			url: "/api/me",
			cookies: { sid: first },
		});
		const dead = await app.inject({
			method: "GET",
			url: "/api/me",
			cookies: { sid: second },
		});
		expect(alive.statusCode).toBe(200);
		expect(dead.statusCode).toBe(401);

		const [row] = await db.select().from(users).where(eq(users.id, user.id));
		expect(row.passwordChangedAt).toBeInstanceOf(Date);
		expect(row.mustChangePassword).toBe(false);
		expect((await verifyPassword(newPassword, row.passwordHash)).ok).toBe(true);
		expect(
			(await attempt({ username: user.username, password })).statusCode,
		).toBe(401);
		expect(
			(await attempt({ username: user.username, password: newPassword }))
				.statusCode,
		).toBe(200);

		const { rows } = await pool.query(
			"select summary from audit_log where action = 'password.change' and actor_id = $1",
			[user.id],
		);
		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows)).not.toContain(newPassword);
	});

	test("repeated wrong current passwords hit the same throttle as login", async () => {
		const user = await makePasswordUser("changelock");
		const session = sidFrom(
			await attempt({ username: user.username, password }),
		) as string;
		await setThrottle("user", userKey(user.username, "127.0.0.1"), {
			failures: 6,
			ageSeconds: 0,
		});
		const response = await injectAs(app, session, "POST", "/api/me/password", {
			currentPassword: password,
			newPassword: "another long passphrase 99",
		});
		expect(response.statusCode).toBe(429);
		expect(response.headers["retry-after"]).toBeDefined();
	});

	test("an SSO-only account is told it signs in with SSO", async () => {
		const sso = await makeUser(run, "ssopw");
		const response = await injectAs(
			app,
			sso.session,
			"POST",
			"/api/me/password",
			{
				currentPassword: "whatever whatever",
				newPassword: "another long passphrase 99",
			},
		);
		expect(response.statusCode).toBe(409);
		expect(response.json()).toEqual({
			error: "This account signs in with SSO",
		});
	});
});

describe("forced password change", () => {
	test("every API route except the three answers 403 until the password is changed", async () => {
		const user = await makePasswordUser("must", { mustChange: true });
		const loggedIn = await attempt({ username: user.username, password });
		expect(loggedIn.json().mustChangePassword).toBe(true);
		const sid = sidFrom(loggedIn) as string;

		const me = await injectAs(app, sid, "GET", "/api/me");
		expect(me.statusCode).toBe(200);
		expect(me.json().mustChangePassword).toBe(true);

		const blocked: Array<[string, string, unknown?]> = [
			["GET", "/api/me/tokens"],
			["POST", "/api/me/tokens", { name: "x" }],
			["GET", "/api/users"],
			["GET", "/api/projects"],
			["GET", "/api/admin/audit"],
			["GET", "/%61pi/me/tokens"],
		];
		for (const [method, url, payload] of blocked) {
			const response = await app.inject({
				method: method as "GET" | "POST",
				url,
				cookies: { sid },
				headers: { "x-requested-with": "rvna" },
				payload: payload as never,
			});
			expect(response.statusCode, `${method} ${url}`).toBe(403);
			expect(response.json()).toEqual({ error: "Password change required" });
		}

		const token = `rvna_${run}_must`;
		await db.insert(apiTokens).values({
			userId: user.id,
			name: `t-${run}`,
			tokenHash: sha256(token),
		});
		const bearer = await app.inject({
			method: "GET",
			url: "/api/projects",
			headers: { authorization: `Bearer ${token}` },
		});
		expect(bearer.statusCode).toBe(200);

		const changed = await injectAs(app, sid, "POST", "/api/me/password", {
			currentPassword: password,
			newPassword: "another long passphrase 99",
		});
		expect(changed.statusCode).toBe(204);
		const bearerAfter = await app.inject({
			method: "GET",
			url: "/api/projects",
			headers: { authorization: `Bearer ${token}` },
		});
		expect(bearerAfter.statusCode).toBe(401);
		const after = await injectAs(app, sid, "GET", "/api/me/tokens");
		expect(after.statusCode).toBe(200);
		expect((await injectAs(app, sid, "GET", "/api/me")).json()).toMatchObject({
			mustChangePassword: false,
		});
	});

	test("the user can still log out", async () => {
		const user = await makePasswordUser("mustlogout", { mustChange: true });
		const sid = sidFrom(
			await attempt({ username: user.username, password }),
		) as string;
		const logout = await injectAs(app, sid, "POST", "/auth/logout");
		expect(logout.statusCode).toBe(200);
		expect(logout.json()).toEqual({ redirect: "/" });
		expect((await injectAs(app, sid, "GET", "/api/me")).statusCode).toBe(401);
	});
});

describe("GET /auth/config", () => {
	test("reports SSO, auto redirect and dev login without a session", async () => {
		const response = await app.inject({ method: "GET", url: "/auth/config" });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			sso: true,
			ssoAutoRedirect: false,
			devLogin: false,
		});
	});

	test("/login.jsp is not a server route unless SSO_AUTO_REDIRECT is set", async () => {
		const response = await app.inject({ method: "GET", url: "/login.jsp" });
		expect(response.statusCode).not.toBe(302);
	});
});

describe("spawned servers", () => {
	test("starts without any OIDC setting: local login only", async () => {
		const server = await startServer({});

		const config = await fetch(`${server.base}/auth/config`);
		expect(await config.json()).toEqual({
			sso: false,
			ssoAutoRedirect: false,
			devLogin: false,
		});

		const sso = await fetch(`${server.base}/auth/login`, {
			redirect: "manual",
		});
		expect(sso.status).toBe(404);
		expect(await sso.json()).toEqual({
			error: "Single sign-on is not configured",
		});
		const callback = await fetch(`${server.base}/auth/callback?code=x&state=y`);
		expect(callback.status).toBe(404);

		const user = await makePasswordUser("spawned");
		const response = await fetch(`${server.base}/auth/local`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-requested-with": "rvna",
			},
			body: JSON.stringify({ username: user.username, password }),
		});
		expect(response.status).toBe(200);
		const cookie = response.headers.get("set-cookie") ?? "";
		const me = await fetch(`${server.base}/api/me`, {
			headers: { cookie: cookie.split(";")[0] as string },
		});
		expect((await me.json()).username).toBe(user.username);

		const logout = await fetch(`${server.base}/auth/logout`, {
			method: "POST",
			headers: {
				cookie: cookie.split(";")[0] as string,
				"x-requested-with": "rvna",
			},
		});
		expect(await logout.json()).toEqual({ redirect: "/" });
		expect(server.output.join("")).not.toContain(password);
	}, 60_000);

	test("SSO_AUTO_REDIRECT sends /login.jsp and /login to SSO unless ?local=1", async () => {
		const server = await startServer({
			OIDC_ISSUER: process.env.OIDC_ISSUER as string,
			OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID as string,
			OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET as string,
			SSO_AUTO_REDIRECT: "true",
		});

		expect(await (await fetch(`${server.base}/auth/config`)).json()).toEqual({
			sso: true,
			ssoAutoRedirect: true,
			devLogin: false,
		});

		for (const path of ["/login.jsp", "/login"]) {
			const redirect = await fetch(
				`${server.base}${path}?returnTo=${encodeURIComponent("/browse/ABC-1")}`,
				{ redirect: "manual" },
			);
			expect(redirect.status).toBe(302);
			expect(redirect.headers.get("location")).toBe(
				`/auth/login?returnTo=${encodeURIComponent("/browse/ABC-1")}`,
			);

			const evil = await fetch(
				`${server.base}${path}?returnTo=//evil.example`,
				{
					redirect: "manual",
				},
			);
			expect(evil.headers.get("location")).toBe("/auth/login?returnTo=%2F");

			const local = await fetch(`${server.base}${path}?local=1`, {
				redirect: "manual",
			});
			expect(local.status).not.toBe(302);
		}
	}, 60_000);

	test("dev login records last_login_at, keeps the password, and ADDRESS_HEADER reads X-Forwarded-For", async () => {
		const dev = await makePasswordUser("devuser");
		const server = await startServer({
			DEV_LOGIN_USER: dev.username,
			ADDRESS_HEADER: "x-forwarded-for",
			XFF_DEPTH: "1",
		});

		expect(await (await fetch(`${server.base}/auth/config`)).json()).toEqual({
			sso: false,
			ssoAutoRedirect: false,
			devLogin: true,
		});

		// With ADDRESS_HEADER set, adapter-node refuses a request that lacks the proxy's header.
		const response = await fetch(`${server.base}/auth/login?returnTo=%2Fx`, {
			redirect: "manual",
			headers: { "x-forwarded-for": `${ipBase}.250` },
		});
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/x");
		expect(response.headers.get("set-cookie")).toContain("sid=");

		const [row] = await db.select().from(users).where(eq(users.id, dev.id));
		expect(row.lastLoginAt).toBeInstanceOf(Date);
		expect(row.passwordHash).toBe(hash);

		const forwarded = `${ipBase}.251`;
		const forged = `${ipBase}.252`;
		usedIps.add(forwarded);
		usedIps.add(forged);
		await fetch(`${server.base}/auth/local`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-requested-with": "rvna",
				// The proxy appends the real address; the client can only forge what comes before it.
				"x-forwarded-for": `${forged}, ${forwarded}`,
			},
			body: JSON.stringify({ username: name("nobody"), password }),
		});
		expect((await throttleRow("ip", forwarded))?.failures).toBe(1);
		expect(await throttleRow("ip", forged)).toBeUndefined();
	}, 60_000);
});

describe("SSO login", () => {
	test("records last_login_at", async () => {
		const sub = `sub-${run}-lastlogin`;
		const { sessionId } = await login(app, {
			sub,
			username: name("lastlogin"),
			name: "Last Login",
			groups: [],
		});
		expect(sessionId).toBeTruthy();
		const [row] = await db.select().from(users).where(eq(users.oidcSub, sub));
		expect(row.lastLoginAt).toBeInstanceOf(Date);
	});

	test("group sync keeps local groups and admin_local administrators", async () => {
		const localGroup = name("localgroup");
		const ssoGroup = name("ssogroup");
		const user = await makePasswordUser("syncadmin");
		await db
			.update(users)
			.set({ oidcSub: `sub-${run}-syncadmin`, adminLocal: true, isAdmin: true })
			.where(eq(users.id, user.id));
		await pool.query("insert into groups (name, local) values ($1, true)", [
			localGroup,
		]);
		await pool.query(
			"insert into user_groups (user_id, group_id, source) select $1, id, 'local' from groups where name = $2",
			[user.id, localGroup],
		);
		await pool.query("insert into groups (name, local) values ($1, false)", [
			ssoGroup,
		]);
		await pool.query(
			"insert into user_groups (user_id, group_id) select $1, id from groups where name = $2",
			[user.id, ssoGroup],
		);

		const claims = {
			sub: `sub-${run}-syncadmin`,
			username: user.username,
			name: "Sync Admin",
		};
		const { sessionId } = await login(app, {
			...claims,
			groups: [name("other"), localGroup],
		});
		const me = await app.inject({
			method: "GET",
			url: "/api/me",
			cookies: { sid: sessionId as string },
		});
		expect(me.json().groups).toEqual([localGroup, name("other")].sort());
		expect(me.json().groups).not.toContain(ssoGroup);
		expect(me.json().isAdmin).toBe(true);

		const { rows } = await pool.query(
			"select name, local from groups where name = any($1) order by name",
			[[localGroup, name("other")]],
		);
		expect(rows).toEqual(
			[
				{ name: localGroup, local: true },
				{ name: name("other"), local: false },
			].sort((a, b) => a.name.localeCompare(b.name)),
		);

		const withAdminGroup = await login(app, {
			...claims,
			groups: [adminGroup()],
		});
		expect(withAdminGroup.sessionId).toBeTruthy();
		const [after] = await db.select().from(users).where(eq(users.id, user.id));
		expect(after.isAdmin).toBe(true);
	});

	test("a claim that names a local group does not join it", async () => {
		const localGroup = name("claimed");
		await pool.query("insert into groups (name, local) values ($1, true)", [
			localGroup,
		]);
		const { sessionId } = await login(app, {
			sub: `sub-${run}-claimed`,
			username: name("claimed"),
			name: "Claimed",
			groups: [localGroup],
		});
		const me = await app.inject({
			method: "GET",
			url: "/api/me",
			cookies: { sid: sessionId as string },
		});
		expect(me.json().groups).toEqual([]);
		const { rows } = await pool.query(
			"select local from groups where name = $1",
			[localGroup],
		);
		expect(rows[0].local).toBe(true);
	});

	test("a plain SSO user without admin_local loses admin when the claim goes", async () => {
		const claims = {
			sub: `sub-${run}-plain`,
			username: name("plain"),
			name: "Plain",
		};
		await login(app, { ...claims, groups: [adminGroup()] });
		const [admin] = await db
			.select()
			.from(users)
			.where(eq(users.oidcSub, claims.sub));
		expect(admin.isAdmin).toBe(true);
		await login(app, { ...claims, groups: [] });
		const [plain] = await db
			.select()
			.from(users)
			.where(eq(users.oidcSub, claims.sub));
		expect(plain.isAdmin).toBe(false);
	});
});
