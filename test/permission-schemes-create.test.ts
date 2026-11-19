import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { DEFAULT_SCHEME_GRANTS } from "../src/lib/server/permissions.ts";
import {
	issues,
	issueTypes,
	permissionGrants,
	priorities,
	statuses,
} from "../src/lib/server/schema.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const projectKey = `PC${run.slice(0, 6).toUpperCase()}`;
const projectName = `Private project ${run}`;
const issueSummary = `Private issue ${run}`;

let app: TestApp;
let admin: TestUser;
let outsider: TestUser;
let member: TestUser;
let projectId: string;
let typeId: string;
let statusId: string;
let priorityId: string;
let privateSchemeId: string;
let publicSchemeId: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();

	admin = await makeUser(run, "admin", { admin: true });
	outsider = await makeUser(run, "outsider");
	member = await makeUser(run, "member");

	const [status] = await db
		.insert(statuses)
		.values({
			sourceId: `test:${run}:status`,
			name: `To Do ${run}`,
			category: "new",
		})
		.returning({ id: statuses.id });
	statusId = status.id;
	const [type] = await db
		.insert(issueTypes)
		.values({ sourceId: `test:${run}:type`, name: `Task ${run}` })
		.returning({ id: issueTypes.id });
	typeId = type.id;
	const [priority] = await db
		.insert(priorities)
		.values({
			sourceId: `test:${run}:priority`,
			name: `Medium ${run}`,
			sequence: 1,
		})
		.returning({ id: priorities.id });
	priorityId = priority.id;

	const created = await injectAs(
		app,
		admin.session,
		"POST",
		"/api/admin/projects",
		{
			name: projectName,
			key: projectKey,
			type: "software",
		},
	);
	expect(created.statusCode).toBe(201);
	projectId = created.json().id;

	await db.insert(issues).values({
		sourceId: `test:${run}:issue`,
		projectId,
		number: 1,
		key: `${projectKey}-1`,
		typeId,
		statusId,
		priorityId,
		summary: issueSummary,
		descriptionSource: issueSummary,
		created: new Date(),
		updated: new Date(),
	});

	const added = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/projects/${projectKey}/roles/member/actors`,
		{ actorType: "user", actorId: member.id },
	);
	expect(added.statusCode).toBe(201);
});

afterAll(async () => {
	if (privateSchemeId) {
		await pool.query("delete from permission_schemes where id = $1", [
			privateSchemeId,
		]);
	}
	if (publicSchemeId) {
		await pool.query("delete from permission_schemes where id = $1", [
			publicSchemeId,
		]);
	}
	if (projectId) {
		await pool.query("delete from projects where id = $1", [projectId]);
	}
	if (typeId)
		await pool.query("delete from issue_types where id = $1", [typeId]);
	if (statusId)
		await pool.query("delete from statuses where id = $1", [statusId]);
	if (priorityId) {
		await pool.query("delete from priorities where id = $1", [priorityId]);
	}
	await pool.query("delete from audit_log where actor_id = $1", [admin.id]);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

async function search(session: string) {
	return injectAs(app, session, "POST", "/api/search", {
		jql: `project = ${projectKey}`,
	});
}

async function issueSearch(session: string) {
	return injectAs(
		app,
		session,
		"GET",
		`/api/search/issues?jql=${encodeURIComponent(`project = ${projectKey}`)}`,
	);
}

async function quickSearch(session: string) {
	return injectAs(
		app,
		session,
		"GET",
		`/api/quicksearch?q=${encodeURIComponent(issueSummary)}`,
	);
}

test("an administrator can create a scheme, remove the anyone grant and make a project private", async () => {
	const before = await injectAs(
		app,
		outsider.session,
		"GET",
		`/projects/${projectKey}/issues`,
	);
	expect(before.statusCode).toBe(200);

	const created = await injectAs(
		app,
		admin.session,
		"POST",
		"/api/admin/permission-schemes",
		{
			name: `Private scheme ${run}`,
			description: "Made for the private project",
		},
	);
	expect(created.statusCode).toBe(201);
	const scheme = created.json().scheme;
	privateSchemeId = scheme.id;
	expect(scheme).toMatchObject({
		name: `Private scheme ${run}`,
		description: "Made for the private project",
		source: "local",
		projects: [],
	});
	expect(scheme.sourceId.startsWith("local:")).toBe(true);

	const detail = await injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/permission-schemes/${privateSchemeId}`,
	);
	expect(detail.statusCode).toBe(200);
	const grants = detail.json().grants as {
		id: string;
		permissionKey: string;
		holderType: string;
	}[];
	expect(grants).toHaveLength(DEFAULT_SCHEME_GRANTS.length);
	const anyoneBrowse = grants.find(
		(grant) =>
			grant.permissionKey === "BROWSE_PROJECTS" &&
			grant.holderType === "anyone",
	);
	expect(anyoneBrowse).toBeDefined();

	const removed = await injectAs(
		app,
		admin.session,
		"DELETE",
		`/api/admin/permission-schemes/${privateSchemeId}/grants/${anyoneBrowse?.id}`,
	);
	expect(removed.statusCode).toBe(204);

	const assigned = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${privateSchemeId}/projects`,
		{ projectId },
	);
	expect(assigned.statusCode).toBe(200);
	expect(assigned.json().scheme.projects).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: projectId, key: projectKey }),
		]),
	);

	for (const [session, label] of [
		[outsider.session, "outsider"],
		[member.session, "member"],
	] as const) {
		const page = await injectAs(
			app,
			session,
			"GET",
			`/projects/${projectKey}/issues`,
		);
		const issue = await injectAs(
			app,
			session,
			"GET",
			`/browse/${projectKey}-1`,
		);
		const found = await search(session);
		const issueFound = await issueSearch(session);
		const quick = await quickSearch(session);
		if (label === "outsider") {
			expect(page.statusCode).toBe(404);
			expect(issue.statusCode).toBe(404);
			expect(found.json().total).toBe(0);
			expect(issueFound.json().total).toBe(0);
			expect(quick.json().issues).toEqual([]);
			expect(quick.json().projects).toEqual([]);
		} else {
			expect(page.statusCode).toBe(200);
			expect(issue.statusCode).toBe(200);
			expect(found.json().total).toBe(1);
			expect(issueFound.json().total).toBe(1);
			expect(quick.json().issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ key: `${projectKey}-1` }),
				]),
			);
		}
	}

	const other = await injectAs(
		app,
		admin.session,
		"POST",
		"/api/admin/permission-schemes",
		{ name: `Public scheme ${run}` },
	);
	expect(other.statusCode).toBe(201);
	publicSchemeId = other.json().scheme.id;
	const moved = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${publicSchemeId}/projects`,
		{ projectId },
	);
	expect(moved.statusCode).toBe(200);
	expect(moved.json().scheme.projects).toEqual(
		expect.arrayContaining([expect.objectContaining({ id: projectId })]),
	);
	const first = await injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/permission-schemes/${privateSchemeId}`,
	);
	expect(first.json().scheme.projects).toEqual([]);

	const visibleAgain = await injectAs(
		app,
		outsider.session,
		"GET",
		`/projects/${projectKey}/issues`,
	);
	expect(visibleAgain.statusCode).toBe(200);

	const movedBack = await injectAs(
		app,
		admin.session,
		"POST",
		`/api/admin/permission-schemes/${privateSchemeId}/projects`,
		{ projectId },
	);
	expect(movedBack.statusCode).toBe(200);
	const hiddenAgain = await injectAs(
		app,
		outsider.session,
		"GET",
		`/projects/${projectKey}/issues`,
	);
	expect(hiddenAgain.statusCode).toBe(404);

	const rows = await db
		.select({ id: permissionGrants.id })
		.from(permissionGrants)
		.where(eq(permissionGrants.schemeId, privateSchemeId));
	expect(rows).toHaveLength(DEFAULT_SCHEME_GRANTS.length - 1);
});
