import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { LEGACY_URLS } from "../src/lib/server/legacy.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureRun,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = fixtureRun();
const projectKey = `LEG${run.slice(0, 4).toUpperCase()}`;

let app: TestApp;
let client: Client;
let session: string;
let token: string;
let dashboardSourceId: string;
let filterSourceId: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const loggedIn = await login(app, {
		sub: `sub-legacy-${run}`,
		username: `t-${run}-legacy`,
		name: "Legacy User",
		groups: [],
	});
	session = loggedIn.sessionId as string;

	await createProjectFixture(client, {
		run,
		key: projectKey,
		issues: [
			{ summary: "Legacy first issue" },
			{ summary: "Legacy second issue", status: "done" },
		],
	});

	const dashboard = await inject("POST", "/api/dashboards", {
		name: `Legacy dashboard ${run}`,
		shared: true,
	});
	dashboardSourceId = `dashboard-${run}`;
	await pool.query("update dashboards set source_id = $1 where id = $2", [
		dashboardSourceId,
		dashboard.json().id,
	]);

	const filter = await inject("POST", "/api/filters", {
		name: `Legacy filter ${run}`,
		jql: `project = ${projectKey} ORDER BY key ASC`,
		shared: true,
	});
	filterSourceId = `filter-${run}`;
	await pool.query("update filters set source_id = $1 where id = $2", [
		filterSourceId,
		filter.json().id,
	]);

	const created = await inject("POST", "/api/me/tokens", {
		name: `Legacy token ${run}`,
	});
	token = created.json().token;
});

afterAll(async () => {
	if (client) {
		await dropProjectFixture(client, run);
		await client.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function inject(
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	url: string,
	payload?: unknown,
) {
	return app.inject({
		method,
		url,
		cookies: { sid: session },
		headers: { "x-requested-with": "rvna" },
		payload: payload as object | undefined,
	});
}

test("every Jira URL shape is in the table", () => {
	const patterns = LEGACY_URLS.map((entry) => entry.pattern);
	expect(patterns).toEqual(
		expect.arrayContaining([
			"/browse/<KEY>-<n>",
			"/browse/<KEY>",
			"/projects/<KEY>/issues/<KEY>-<n>",
			"/projects/<KEY>/summary",
			"/issues/?jql=",
			"/issues/?filter=<source id>",
			"/secure/IssueNavigator.jspa",
			"/secure/IssueNavigator.jspa?jqlQuery=",
			"/secure/QuickSearch.jspa?searchString=",
			"/secure/ViewProfile.jspa?name=",
			"/secure/attachment/<source id>/<filename>",
			"/secure/CreateIssue!default.jspa",
			"/secure/ManageFilters.jspa",
			"/secure/BrowseProjects.jspa",
			"/plugins/servlet/project-config/<KEY>/summary",
			"/secure/Logout!default.jspa",
			"/rest/api/2/issue/<KEY>",
			"/rest/api/2/search?jql=",
		]),
	);
	for (const entry of LEGACY_URLS) {
		expect(entry.target).not.toBe("");
	}
});

test("the Jira URLs redirect to the screen that serves them", async () => {
	const rows: {
		url: string;
		status: number;
		location?: string;
	}[] = [
		{ url: "/browse/DEMO", status: 302, location: "/projects/DEMO/summary" },
		{
			url: `/projects/${projectKey}/issues/${projectKey}-1`,
			status: 302,
			location: `/browse/${projectKey}-1`,
		},
		{
			url: `/issues/?filter=${filterSourceId}`,
			status: 302,
		},
		{
			url: `/secure/Dashboard.jspa?selectPageId=${dashboardSourceId}`,
			status: 302,
		},
		{
			url: `/secure/QuickSearch.jspa?searchString=${projectKey}-1`,
			status: 302,
			location: `/browse/${projectKey}-1`,
		},
		{
			url: "/secure/CreateIssue!default.jspa",
			status: 302,
			location: "/issues/?create=1",
		},
		{
			url: `/secure/attachment/10001/file.txt`,
			status: 302,
			location: "/api/attachments/10001",
		},
		{ url: "/secure/attachmentzip/10001.zip", status: 501 },
	];

	for (const row of rows) {
		const response = await inject("GET", row.url);
		expect({ url: row.url, status: response.statusCode }).toEqual({
			url: row.url,
			status: row.status,
		});
		if (row.location) {
			expect({ url: row.url, location: response.headers.location }).toEqual({
				url: row.url,
				location: row.location,
			});
		}
	}

	const filterRedirect = await inject(
		"GET",
		`/issues/?filter=${filterSourceId}&view=list`,
	);
	expect(filterRedirect.headers.location).toMatch(
		/^\/issues\/\?filter=[0-9a-f-]{36}&view=list$/,
	);

	const dashboardRedirect = await inject(
		"GET",
		`/secure/Dashboard.jspa?selectPageId=${dashboardSourceId}`,
	);
	expect(dashboardRedirect.headers.location).toMatch(
		/^\/secure\/Dashboard\.jspa\?selectPageId=[0-9a-f-]{36}$/,
	);

	const search = await inject(
		"GET",
		"/secure/QuickSearch.jspa?searchString=Legacy%20first",
	);
	expect(search.statusCode).toBe(302);
	expect(search.headers.location).toMatch(/^\/issues\/\?jql=/);
	expect(decodeURIComponent(search.headers.location ?? "")).toContain(
		'text ~ "Legacy first"',
	);
});

test("the pages that stay pages answer with the app shell", async () => {
	for (const url of [
		`/browse/${projectKey}-1`,
		`/projects/${projectKey}/summary`,
		`/issues/?jql=${encodeURIComponent(`project = ${projectKey}`)}`,
		"/secure/IssueNavigator.jspa",
		"/secure/ManageFilters.jspa",
		"/secure/BrowseProjects.jspa",
		`/plugins/servlet/project-config/${projectKey}/summary`,
		"/secure/ConfigurePortalPages!default.jspa",
		`/secure/ViewProfile.jspa?name=t-${run}-legacy`,
	]) {
		const response = await inject("GET", url);
		expect({ url, status: response.statusCode }).toEqual({ url, status: 200 });
		expect(response.headers["content-type"]).toContain("text/html");
		if (url === "/secure/BrowseProjects.jspa") {
			expect(response.body).toMatch(/<title>Projects - /);
		}
	}
});

test("an old navigator bookmark keeps its jqlQuery", async () => {
	const response = await inject(
		"GET",
		`/secure/IssueNavigator.jspa?mode=hide&jqlQuery=${encodeURIComponent(
			`key = ${projectKey}-2`,
		)}`,
	);
	expect(response.statusCode).toBe(200);
	expect(response.body).toContain(`${projectKey}-2`);
	expect(response.body).not.toContain(`${projectKey}-1`);
});

test("the Jira REST API answers an issue with Jira's shape", async () => {
	const response = await app.inject({
		method: "GET",
		url: `/rest/api/2/issue/${projectKey}-1`,
		headers: { authorization: `Bearer ${token}` },
	});
	expect(response.statusCode).toBe(200);
	const issue = response.json();
	expect(issue.key).toBe(`${projectKey}-1`);
	expect(issue.id).toMatch(/^fixture:/);
	expect(issue.self).toContain(`/rest/api/2/issue/`);
	expect(issue.fields.summary).toBe("Legacy first issue");
	expect(issue.fields.issuetype.name).toBe("Task");
	expect(issue.fields.status.name).toBe("To Do");
	expect(issue.fields.status.statusCategory.key).toBe("new");
	expect(issue.fields.project.key).toBe(projectKey);
	expect(issue.fields.created).toMatch(/\+0000$/);

	const missing = await app.inject({
		method: "GET",
		url: "/rest/api/2/issue/NOPE-1",
		headers: { authorization: `Bearer ${token}` },
	});
	expect(missing.statusCode).toBe(404);
	expect(missing.json().errorMessages).toHaveLength(1);
});

test("the Jira REST API searches with JQL", async () => {
	const response = await app.inject({
		method: "GET",
		url: `/rest/api/2/search?jql=${encodeURIComponent(`project = ${projectKey} ORDER BY key ASC`)}`,
		headers: { authorization: `Bearer ${token}` },
	});
	expect(response.statusCode).toBe(200);
	const result = response.json();
	expect(result).toMatchObject({ startAt: 0, total: 2 });
	expect(result.issues.map((issue: { key: string }) => issue.key)).toEqual([
		`${projectKey}-1`,
		`${projectKey}-2`,
	]);

	const paged = await app.inject({
		method: "GET",
		url: `/rest/api/2/search?jql=${encodeURIComponent(`project = ${projectKey} ORDER BY key ASC`)}&startAt=1&maxResults=1`,
		headers: { authorization: `Bearer ${token}` },
	});
	expect(paged.json().total).toBe(2);
	expect(paged.json().issues).toHaveLength(1);
	expect(paged.json().issues[0].key).toBe(`${projectKey}-2`);

	const broken = await app.inject({
		method: "GET",
		url: "/rest/api/2/search?jql=nonsense%20%3D%3D%3D",
		headers: { authorization: `Bearer ${token}` },
	});
	expect(broken.statusCode).toBe(400);
	expect(broken.json().errorMessages).toHaveLength(1);
});

test("unmatched REST paths answer a JSON 404 instead of the app shell", async () => {
	for (const url of [
		"/rest/api/2/myself",
		"/rest/api/2/does-not-exist",
		"/rest/unknown",
	]) {
		const response = await inject("GET", url);
		expect({ url, status: response.statusCode }).toEqual({ url, status: 404 });
		expect(response.headers["content-type"]).toContain("application/json");
		// Without a build Fastify's own 404 answers; both are JSON, never the app shell.
		expect(response.json().error).toMatch(/not found/i);
	}

	const implemented = await app.inject({
		method: "GET",
		url: `/rest/api/2/issue/${projectKey}-1`,
		headers: { authorization: `Bearer ${token}` },
	});
	expect(implemented.statusCode).toBe(200);
});

test("a Jira logout link asks before it ends the session", async () => {
	const anonymous = await app.inject({
		method: "GET",
		url: "/secure/Logout!default.jspa",
	});
	expect(anonymous.statusCode).toBe(302);
	expect(anonymous.headers.location).toBe(
		"/login.jsp?returnTo=%2Fsecure%2FLogout!default.jspa",
	);

	const confirmation = await inject("GET", "/secure/Logout!default.jspa");
	expect(confirmation.statusCode).toBe(200);
	expect(confirmation.headers["content-type"]).toContain("text/html");
	expect(confirmation.body).toContain("Log out");

	const stillSignedIn = await inject("GET", "/api/me");
	expect(stillSignedIn.statusCode).toBe(200);

	const logout = await inject("POST", "/auth/logout");
	expect(logout.statusCode).toBe(200);
	expect((await inject("GET", "/api/me")).statusCode).toBe(401);
});

test("the Jira REST API refuses a request without an API token", async () => {
	const anonymous = await app.inject({
		method: "GET",
		url: `/rest/api/2/issue/${projectKey}-1`,
	});
	expect(anonymous.statusCode).toBe(401);
	expect(anonymous.json().errorMessages).toHaveLength(1);

	const sessionOnly = await inject("GET", `/rest/api/2/issue/${projectKey}-1`);
	expect(sessionOnly.statusCode).toBe(401);
});
