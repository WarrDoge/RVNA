import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { apiTokens, users } from "../src/lib/server/schema.ts";
import { load as loadBrowser } from "../src/routes/(admin)/secure/admin/user/UserBrowser.jspa/+page.server.ts";
import { load as loadUser } from "../src/routes/(admin)/secure/admin/user/ViewUser.jspa/+page.server.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const tokenHash = `token-hash-${run}`;
let admin: CurrentUser;
let subject: { id: string; username: string };
let passwordHash: string;

function event(path: string, user: CurrentUser) {
	return {
		locals: { user },
		url: new URL(`http://localhost${path}`),
		params: {},
		route: { id: path.split("?")[0] },
		depends: () => undefined,
	} as never;
}

beforeAll(async () => {
	await runMigrations();
	const made = await makeUser(run, "admin", { admin: true });
	admin = {
		id: made.id,
		username: made.username,
		displayName: `Test admin ${run}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: true,
		mustChangePassword: false,
		hasPassword: true,
	};
	subject = await makeUser(run, "subject");
	passwordHash = `scrypt$salt-${run}$hash-${run}`;
	await db.update(users).set({ passwordHash }).where(eq(users.id, subject.id));
	await db.insert(apiTokens).values({
		userId: subject.id,
		name: `Token ${run}`,
		tokenHash,
	});
});

afterAll(async () => {
	await cleanupTestData(run);
	await pool.end();
});

test("the user list and user view load no password hash and no token hash", async () => {
	const list = await loadBrowser(
		event(
			`/secure/admin/user/UserBrowser.jspa?query=${subject.username}`,
			admin,
		),
	);
	const view = await loadUser(
		event(`/secure/admin/user/ViewUser.jspa?name=${subject.username}`, admin),
	);
	expect(JSON.stringify(list)).toContain(subject.username);
	expect(JSON.stringify(view)).toContain(`Token ${run}`);
	for (const data of [list, view]) {
		const text = JSON.stringify(data);
		for (const secret of [
			passwordHash,
			tokenHash,
			"passwordHash",
			"tokenHash",
		]) {
			expect(text, secret).not.toContain(secret);
		}
	}
});
