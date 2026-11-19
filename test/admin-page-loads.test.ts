import { like } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { customKeyForAdminType } from "../src/lib/server/custom-fields.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { fields, priorities, resolutions } from "../src/lib/server/schema.ts";
import { load as loadUsers } from "../src/routes/(admin)/secure/admin/user/UserBrowser.jspa/+page.server.ts";
import { load as loadAudit } from "../src/routes/(admin)/secure/admin/ViewAuditLog.jspa/+page.server.ts";
import { load as loadFields } from "../src/routes/(admin)/secure/admin/ViewCustomFields.jspa/+page.server.ts";
import { load as loadPriorities } from "../src/routes/(admin)/secure/admin/ViewPriorities.jspa/+page.server.ts";
import { load as loadResolutions } from "../src/routes/(admin)/secure/admin/ViewResolutions.jspa/+page.server.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
let admin: CurrentUser;
let subject: { id: string; username: string };

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
});

afterAll(async () => {
	await db.delete(priorities).where(like(priorities.sourceId, `${run}:%`));
	await db.delete(resolutions).where(like(resolutions.sourceId, `${run}:%`));
	await db.delete(fields).where(like(fields.sourceId, `${run}:%`));
	await cleanupTestData(run);
	await pool.end();
});

test("the user list load returns only the fields the table renders", async () => {
	const data = await loadUsers(
		event(
			`/secure/admin/user/UserBrowser.jspa?query=${subject.username}`,
			admin,
		),
	);
	const user = data.users.find((row) => row.username === subject.username);
	expect(user).toBeDefined();
	expect(user).not.toHaveProperty("adminLocal");
	expect(user).not.toHaveProperty("createdAt");
	expect(user).not.toHaveProperty("mustChangePassword");
});

test("priority and resolution loads omit the sequence they do not render", async () => {
	await db.insert(priorities).values({
		sourceId: `${run}:priority`,
		name: `Priority ${run}`,
		sequence: 4,
	});
	await db.insert(resolutions).values({
		sourceId: `${run}:resolution`,
		name: `Resolution ${run}`,
		sequence: 7,
	});

	const priorityData = await loadPriorities(
		event("/secure/admin/ViewPriorities.jspa", admin),
	);
	const resolutionData = await loadResolutions(
		event("/secure/admin/ViewResolutions.jspa", admin),
	);
	const priority = priorityData.priorities.find(
		(row) => row.name === `Priority ${run}`,
	);
	const resolution = resolutionData.resolutions.find(
		(row) => row.name === `Resolution ${run}`,
	);
	expect(priority).toBeDefined();
	expect(resolution).toBeDefined();
	expect(priority).not.toHaveProperty("sequence");
	expect(resolution).not.toHaveProperty("sequence");
});

test("the custom field list load omits the option count it does not render", async () => {
	await db.insert(fields).values({
		sourceId: `${run}:field`,
		name: `Field ${run}`,
		type: "option",
		customKey: customKeyForAdminType("select"),
	});

	const data = await loadFields(
		event("/secure/admin/ViewCustomFields.jspa", admin),
	);
	const field = data.fields.find((row) => row.name === `Field ${run}`);
	expect(field).toBeDefined();
	expect(field).not.toHaveProperty("optionCount");
});

test("the audit load returns the same day boundaries the page displays", async () => {
	const data = await loadAudit(
		event(
			"/secure/admin/ViewAuditLog.jspa?from=2026-01-02&to=2026-01-03",
			admin,
		),
	);
	expect(data.filters.from).toBe("2026-01-02");
	expect(data.filters.to).toBe("2026-01-03");
	expect(data.fromIso).toBe(new Date("2026-01-02T00:00:00").toISOString());
	expect(data.toIso).toBe(new Date("2026-01-03T23:59:59.999").toISOString());
});
