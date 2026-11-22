import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
	type SeedResult,
} from "./fixtures/project.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = fixtureRun();
const key = fixtureKey(run);
const today = new Date();
// An hour ago, but never before today's UTC midnight: the activity stream groups by UTC day.
const created = new Date(
	Math.max(
		today.getTime() - 60 * 60 * 1000,
		Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
	),
).toISOString();

let app: TestApp;
let client: Client;
let session: string;
let otherSession: string;
let adminSession: string;
let fixture: SeedResult;
let dashboardId: string;
let filterId: string;
let groupId: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const first = await login(app, {
		sub: `sub-${run}-one`,
		username: `t-${run}-one`,
		name: "Gadget Owner",
		groups: [],
	});
	const second = await login(app, {
		sub: `sub-${run}-two`,
		username: `t-${run}-two`,
		name: "Gadget Other",
		groups: [],
	});
	const admin = await login(app, {
		sub: `sub-${run}-admin`,
		username: `t-${run}-admin`,
		name: "Gadget Admin",
		groups: [adminGroup()],
	});
	session = first.sessionId as string;
	otherSession = second.sessionId as string;
	adminSession = admin.sessionId as string;

	const [owner] = (
		await client.query<{ id: string }>(
			"select id from users where username = $1",
			[`t-${run}-one`],
		)
	).rows;
	const [other] = (
		await client.query<{ id: string }>(
			"select id from users where username = $1",
			[`t-${run}-two`],
		)
	).rows;
	if (!owner || !other) throw new Error("The test users were not created");

	const [group] = (
		await client.query<{ id: string }>(
			"insert into groups (name, local) values ($1, false) returning id",
			[`t-${run}-gadget`],
		)
	).rows;
	if (!group) throw new Error("The test group was not created");
	groupId = group.id;
	await client.query(
		"insert into user_groups (user_id, group_id, source) values ($1, $2, 'oidc'), ($3, $2, 'oidc')",
		[owner.id, groupId, other.id],
	);

	fixture = await createProjectFixture(client, {
		run,
		key,
		issues: [
			{
				summary: "Gadget open issue",
				status: "todo",
				type: "task",
				priority: "high",
				assigneeId: owner?.id,
				reporterId: owner?.id,
				labels: ["alpha"],
				created,
			},
			{
				summary: "Gadget done issue",
				status: "done",
				type: "bug",
				priority: "low",
				assigneeId: owner?.id,
				reporterId: other?.id,
				labels: ["beta"],
				created,
			},
			{
				summary: "Gadget other issue",
				status: "inProgress",
				type: "task",
				priority: "high",
				assigneeId: other?.id,
				reporterId: other?.id,
				created,
			},
		],
	});

	const [firstIssue, secondIssue] = fixture.issueIds;
	await client.query("update issues set resolved = $1 where id = $2", [
		today.toISOString(),
		secondIssue,
	]);
	await client.query(
		`insert into watchers (source_id, issue_id, user_id) values ($1, $2, $3)`,
		[`fixture:${run}:watch:1`, firstIssue, owner?.id],
	);
	await client.query(
		`insert into watchers (source_id, issue_id, user_id) values ($1, $2, $3)`,
		[`fixture:${run}:watch:2`, secondIssue, owner?.id],
	);
	await client.query(
		`insert into comments (source_id, issue_id, author_id, body_html, body_source, created)
		 values ($1, $2, $3, $4, $5, $6)`,
		[
			`fixture:${run}:comment:1`,
			firstIssue,
			owner?.id,
			"<p>Working on it</p>",
			"Working on it",
			today.toISOString(),
		],
	);
	const history = await client.query<{ id: string }>(
		`insert into issue_history (source_id, issue_id, author_id, created)
		 values ($1, $2, $3, $4) returning id`,
		[`fixture:${run}:history:1`, firstIssue, owner?.id, today.toISOString()],
	);
	await client.query(
		`insert into issue_history_items (source_id, history_id, field, from_string, to_string, sequence)
		 values ($1, $2, $3, $4, $5, 0)`,
		[
			`fixture:${run}:history-item:1`,
			history.rows[0]?.id,
			"status",
			"To Do",
			"In Progress",
		],
	);
	await client.query(
		`insert into issue_history_items (source_id, history_id, field, from_value, to_value, sequence)
		 values ($1, $2, 'timespent', null, '3600', 1)`,
		[`fixture:${run}:history-item:2`, history.rows[0]?.id],
	);

	const dashboard = await request("POST", "/api/dashboards", session, {
		name: `Gadget dashboard ${run}`,
		shared: true,
	});
	dashboardId = dashboard.json().id;

	const filter = await request("POST", "/api/filters", session, {
		name: `Gadget filter ${run}`,
		jql: `project = ${key} ORDER BY key ASC`,
		shared: true,
	});
	filterId = filter.json().id;
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

function request(
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	url: string,
	userSession: string,
	payload?: unknown,
) {
	return app.inject({
		method,
		url,
		cookies: { sid: userSession },
		headers: { "x-requested-with": "rvna" },
		payload: payload as object | undefined,
	});
}

async function addGadget(
	type: string,
	config: Record<string, unknown> = {},
	title?: string,
) {
	const response = await request(
		"POST",
		`/api/dashboards/${dashboardId}/gadgets`,
		session,
		{ type, config, title },
	);
	expect(response.statusCode).toBe(201);
	return response.json();
}

async function data(id: string, userSession = session, startAt = 0) {
	const response = await request(
		"GET",
		`/api/gadgets/${id}/data?startAt=${startAt}`,
		userSession,
	);
	expect(response.statusCode).toBe(200);
	return response.json();
}

test("Assigned to Me returns the viewer's open issues", async () => {
	const gadget = await addGadget("assigned-to-me", {
		columns: ["type", "key", "summary", "status"],
		rows: 10,
	});
	const body = await data(gadget.id);
	expect(body.issueList.total).toBe(1);
	expect(body.issueList.issues[0].key).toBe(`${key}-1`);

	const other = await data(gadget.id, otherSession);
	expect(other.issueList.total).toBe(1);
	expect(other.issueList.issues[0].key).toBe(`${key}-3`);
});

test("an offset far past the data is rejected", async () => {
	const gadget = await addGadget("assigned-to-me", { rows: 10 });

	const response = await request(
		"GET",
		`/api/gadgets/${gadget.id}/data?startAt=100000000`,
		session,
	);
	expect(response.statusCode).toBe(400);

	const atLimit = await request(
		"GET",
		`/api/gadgets/${gadget.id}/data?startAt=10000`,
		session,
	);
	expect(atLimit.statusCode).toBe(200);
});

test("Watched Issues returns the issues the viewer watches", async () => {
	const gadget = await addGadget("watched-issues", { rows: 10 });
	const body = await data(gadget.id);
	expect(body.issueList.total).toBe(2);

	const openOnly = await addGadget("watched-issues", {
		rows: 10,
		showResolved: false,
	});
	const openBody = await data(openOnly.id);
	expect(openBody.issueList.total).toBe(1);
	expect(openBody.issueList.issues[0].key).toBe(`${key}-1`);
});

test("Filter Results pages through the filter and hides a private filter", async () => {
	const gadget = await addGadget("filter-results", {
		filterId,
		columns: ["key", "summary"],
		rows: 1,
	});
	const first = await data(gadget.id);
	expect(first.issueList.total).toBe(3);
	expect(first.issueList.issues).toHaveLength(1);
	expect(first.issueList.issues[0].key).toBe(`${key}-1`);

	const second = await data(gadget.id, session, 1);
	expect(second.issueList.issues[0].key).toBe(`${key}-2`);

	const privateFilter = await request("POST", "/api/filters", otherSession, {
		name: `Private gadget filter ${run}`,
		jql: `project = ${key} ORDER BY key ASC`,
	});
	const hidden = await addGadget("filter-results", {
		filterId: privateFilter.json().id,
		rows: 10,
	});
	const hiddenBody = await data(hidden.id);
	expect(hiddenBody.issueList.total).toBe(0);
});

test("only an administrator writes the introduction", async () => {
	const denied = await request(
		"POST",
		`/api/dashboards/${dashboardId}/gadgets`,
		session,
		{ type: "introduction", config: { html: "<p>Hello team</p>" } },
	);
	expect(denied.statusCode).toBe(403);

	const created = await request(
		"POST",
		`/api/dashboards/${dashboardId}/gadgets`,
		adminSession,
		{ type: "introduction", config: { html: "<p>Hello team</p>" } },
	);
	expect(created.statusCode).toBe(201);
	const gadget = created.json();

	const body = await data(gadget.id);
	expect(body.html).toBe("<p>Hello team</p>");

	const cleaned = await request(
		"PATCH",
		`/api/gadgets/${gadget.id}`,
		adminSession,
		{ config: { html: "<script>alert(1)</script><p>Still here</p>" } },
	);
	expect(cleaned.statusCode).toBe(200);
	expect((await data(gadget.id)).html).toBe("<p>Still here</p>");
});

test("Pie Chart and Issue Statistics count the issues of a project", async () => {
	const pie = await addGadget("pie-chart", {
		statistic: "status",
		project: key,
	});
	const slices = (await data(pie.id)).slices as {
		label: string;
		value: number;
	}[];
	const byLabel = new Map(slices.map((slice) => [slice.label, slice.value]));
	expect(byLabel.get("To Do")).toBe(1);
	expect(byLabel.get("Done")).toBe(1);
	expect(byLabel.get("In Progress")).toBe(1);

	const statistics = await addGadget("issue-statistics", {
		statistic: "assignee",
		project: key,
	});
	const assignees = (await data(statistics.id)).slices as {
		label: string;
		value: number;
	}[];
	const byAssignee = new Map(
		assignees.map((slice) => [slice.label, slice.value]),
	);
	expect(byAssignee.get("Gadget Owner")).toBe(2);
	expect(byAssignee.get("Gadget Other")).toBe(1);

	const labels = await addGadget("issue-statistics", {
		statistic: "label",
		project: key,
	});
	const labelSlices = (await data(labels.id)).slices as {
		label: string;
		value: number;
	}[];
	const byLabelName = new Map(
		labelSlices.map((slice) => [slice.label, slice.value]),
	);
	expect(byLabelName.get("alpha")).toBe(1);
	expect(byLabelName.get("No label")).toBe(1);
});

test("Two Dimensional Filter Statistics crosses two statistics", async () => {
	const gadget = await addGadget("two-dimensional", {
		xStatistic: "status",
		yStatistic: "priority",
		project: key,
	});
	const matrix = (await data(gadget.id)).matrix as {
		columns: string[];
		rows: { label: string; cells: number[]; total: number }[];
		total: number;
	};
	expect(matrix.total).toBe(3);
	expect(matrix.columns).toContain("High");
	const toDo = matrix.rows.find((row) => row.label === "To Do");
	expect(toDo?.total).toBe(1);
});

test("identical two-dimensional axes are refused and a stored one is an error", async () => {
	const refused = await request(
		"POST",
		`/api/dashboards/${dashboardId}/gadgets`,
		session,
		{
			type: "two-dimensional",
			config: { xStatistic: "status", yStatistic: "status", project: key },
		},
	);
	expect(refused.statusCode).toBe(400);

	const gadget = await addGadget("two-dimensional", {
		xStatistic: "status",
		yStatistic: "priority",
		project: key,
	});
	await client.query(
		"update dashboard_gadgets set config = $1::jsonb where id = $2",
		[
			JSON.stringify({
				xStatistic: "status",
				yStatistic: "status",
				project: key,
			}),
			gadget.id,
		],
	);
	const response = await request(
		"GET",
		`/api/gadgets/${gadget.id}/data`,
		session,
	);
	expect(response.statusCode).toBe(400);

	const page = await request(
		"GET",
		`/secure/Dashboard.jspa?selectPageId=${dashboardId}`,
		otherSession,
	);
	expect(page.statusCode).toBe(200);
	expect(page.body).toContain("Choose two different statistics");
});

test("Created vs Resolved counts the days of the window", async () => {
	const gadget = await addGadget("created-vs-resolved", {
		project: key,
		days: 7,
	});
	const series = (await data(gadget.id)).series as {
		days: string[];
		created: number[];
		resolved: number[];
	};
	expect(series.days).toHaveLength(7);
	expect(series.created.reduce((total, value) => total + value, 0)).toBe(3);
	expect(series.resolved.reduce((total, value) => total + value, 0)).toBe(1);
});

test("Activity Stream groups comments, changes and new issues per day", async () => {
	const gadget = await addGadget("activity-stream", {
		projects: [key],
		days: 7,
		rows: 20,
	});
	const body = await data(gadget.id);
	const groups = body.activity as {
		day: string;
		entries: { kind: string; text: string | null }[];
	}[];
	expect(groups).toHaveLength(1);
	const kinds = new Set(groups[0]?.entries.map((entry) => entry.kind));
	expect(kinds.has("comment")).toBe(true);
	expect(kinds.has("history")).toBe(true);
	expect(kinds.has("created")).toBe(true);
	const change = groups[0]?.entries.find((entry) => entry.kind === "history");
	expect(change?.text).toBe("Status: To Do → In Progress, Time Spent: 1h");

	const otherProject = await addGadget("activity-stream", {
		projects: ["NOTHING"],
		days: 7,
	});
	expect((await data(otherProject.id)).activity).toEqual([]);
});

test("Favourite Filters lists the viewer's filters with counts", async () => {
	await request("PUT", `/api/filters/${filterId}/favourite`, session);
	const gadget = await addGadget("favourite-filters");
	const filters = (await data(gadget.id)).filters as {
		name: string;
		total: number;
	}[];
	const favourite = filters.find(
		(filter) => filter.name === `Gadget filter ${run}`,
	);
	expect(favourite?.total).toBe(3);

	const others = (await data(gadget.id, otherSession)).filters as unknown[];
	expect(others).toEqual([]);
});

test("Quick Links returns its configured links", async () => {
	const gadget = await addGadget("quick-links", {
		links: [{ title: "Handbook", url: "https://example.test/handbook" }],
	});
	expect((await data(gadget.id)).links).toEqual([
		{ title: "Handbook", url: "https://example.test/handbook" },
	]);
});

test("Quick Links rejects unsafe URL schemes and hides stored ones", async () => {
	for (const url of [
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"//example.test/escape",
	]) {
		const denied = await request(
			"POST",
			`/api/dashboards/${dashboardId}/gadgets`,
			session,
			{ type: "quick-links", config: { links: [{ title: "Bad", url }] } },
		);
		expect(denied.statusCode).toBe(400);
	}

	const gadget = await addGadget("quick-links", {
		links: [
			{ title: "Web", url: "https://example.test/handbook" },
			{ title: "Mail", url: "mailto:team@example.test" },
			{ title: "Local", url: "/browse/ABC-1" },
		],
	});
	expect((await data(gadget.id)).links).toEqual([
		{ title: "Web", url: "https://example.test/handbook" },
		{ title: "Mail", url: "mailto:team@example.test" },
		{ title: "Local", url: "/browse/ABC-1" },
	]);

	const deniedPatch = await request(
		"PATCH",
		`/api/gadgets/${gadget.id}`,
		session,
		{
			config: {
				links: [{ title: "Bad", url: "javascript:alert(1)" }],
			},
		},
	);
	expect(deniedPatch.statusCode).toBe(400);

	await client.query(
		"update dashboard_gadgets set config = $1::jsonb where id = $2",
		[
			JSON.stringify({
				links: [
					{ title: "Stored bad", url: "javascript:alert(1)" },
					{ title: "Stored good", url: "/browse/ABC-1" },
				],
			}),
			gadget.id,
		],
	);
	expect((await data(gadget.id)).links).toEqual([
		{ title: "Stored good", url: "/browse/ABC-1" },
	]);
});

test("copying a dashboard revalidates every gadget configuration", async () => {
	const source = await request("POST", "/api/dashboards", session, {
		name: `Copy source ${run}`,
		shared: true,
	});
	expect(source.statusCode).toBe(201);
	const sourceId = source.json().id as string;

	const gadget = await request(
		"POST",
		`/api/dashboards/${sourceId}/gadgets`,
		session,
		{
			type: "quick-links",
			config: {
				links: [{ title: "Safe", url: "https://example.test/handbook" }],
			},
		},
	);
	expect(gadget.statusCode).toBe(201);
	await client.query(
		"update dashboard_gadgets set config = $1::jsonb where id = $2",
		[
			JSON.stringify({
				links: [{ title: "Stored bad", url: "javascript:alert(1)" }],
			}),
			gadget.json().id,
		],
	);

	const copy = await request("POST", "/api/dashboards", session, {
		name: `Copy target ${run}`,
		copyOf: sourceId,
	});
	expect(copy.statusCode).toBe(201);
	const copied = copy.json().gadgets;
	expect(copied).toHaveLength(1);
	expect(JSON.stringify(copied)).not.toContain("javascript:");
});

test("Filter Results and Favourite Filters honour group shares", async () => {
	const sharedFilter = await request("POST", "/api/filters", session, {
		name: `Group shared gadget filter ${run}`,
		jql: `project = ${key} ORDER BY key ASC`,
		sharedGroupIds: [groupId],
	});
	expect(sharedFilter.statusCode).toBe(201);
	const sharedFilterId = sharedFilter.json().id as string;

	const gadget = await addGadget("filter-results", {
		filterId: sharedFilterId,
		rows: 10,
	});
	expect((await data(gadget.id, otherSession)).issueList.total).toBe(3);

	await request(
		"PUT",
		`/api/filters/${sharedFilterId}/favourite`,
		otherSession,
	);
	const favourites = await addGadget("favourite-filters");
	const filters = (await data(favourites.id, otherSession)).filters as {
		id: string;
		total: number;
	}[];
	expect(filters.find((filter) => filter.id === sharedFilterId)?.total).toBe(3);

	const privateFilter = await request("POST", "/api/filters", otherSession, {
		name: `Private hidden gadget filter ${run}`,
		jql: `project = ${key} ORDER BY key ASC`,
	});
	expect(privateFilter.statusCode).toBe(201);
	const pie = await addGadget("pie-chart", {
		statistic: "status",
		filterId: privateFilter.json().id,
	});
	expect((await data(pie.id)).slices).toEqual([]);
});

test("an imported gadget type without a renderer keeps its title", async () => {
	const gadget = await addGadget("assigned-to-me");
	await pool.query(
		"update dashboard_gadgets set type = $1, title = $2 where id = $3",
		["agile-wallboard-gadget", "Agile Wallboard Gadget", gadget.id],
	);
	const body = await data(gadget.id);
	expect(body.kind).toBe("agile-wallboard-gadget");
	expect(body.title).toBe("Agile Wallboard Gadget");
	expect(body.issueList).toBeUndefined();
});

test("a gadget of a private dashboard is not readable by others", async () => {
	const privateDashboard = await request(
		"POST",
		"/api/dashboards",
		otherSession,
		{ name: `Private gadget dashboard ${run}` },
	);
	const gadget = await request(
		"POST",
		`/api/dashboards/${privateDashboard.json().id}/gadgets`,
		otherSession,
		{ type: "favourite-filters" },
	);
	expect(gadget.statusCode).toBe(201);

	const hidden = await request(
		"GET",
		`/api/gadgets/${gadget.json().id}/data`,
		session,
	);
	expect(hidden.statusCode).toBe(404);
});
