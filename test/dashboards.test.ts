import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { userForSession } from "../src/lib/server/auth.ts";
import { dashboardSummarySchema } from "../src/lib/server/dashboards/schemas.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { loadGadgetData } from "../src/lib/server/gadget-data.ts";
import { SYSTEM_DASHBOARD_ID } from "../src/lib/server/schema.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = `dash-${Math.random().toString(36).slice(2, 8)}`;
let app: TestApp;
let ownerSession: string;
let otherSession: string;
let adminSession: string;

beforeAll(async () => {
	await runMigrations();
	// The landing page test below brings its own imported dashboard.
	await pool.query(
		"update dashboards set source_id = source_id || ':test-aside', name = name || ' (test aside)', shared = false where source_id = $1",
		[SYSTEM_DASHBOARD_ID],
	);
	app = buildServer();
	const owner = await login(app, {
		sub: `sub-${run}-owner`,
		username: `t-${run}-owner`,
		name: "Dashboard Owner",
		groups: [],
	});
	const other = await login(app, {
		sub: `sub-${run}-other`,
		username: `t-${run}-other`,
		name: "Other User",
		groups: [],
	});
	const admin = await login(app, {
		sub: `sub-${run}-admin`,
		username: `t-${run}-admin`,
		name: "Admin User",
		groups: [adminGroup()],
	});
	ownerSession = owner.sessionId as string;
	otherSession = other.sessionId as string;
	adminSession = admin.sessionId as string;
});

afterAll(async () => {
	await pool.query(
		"update dashboards set source_id = $1, name = replace(name, ' (test aside)', ''), shared = true where source_id = $2",
		[SYSTEM_DASHBOARD_ID, `${SYSTEM_DASHBOARD_ID}:test-aside`],
	);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function request(
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	url: string,
	session: string,
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

async function createDashboard(
	name: string,
	options: { shared?: boolean; layout?: string } = {},
	session = ownerSession,
) {
	const response = await request("POST", "/api/dashboards", session, {
		name,
		layout: options.layout ?? "AA",
		shared: options.shared ?? false,
	});
	expect(response.statusCode).toBe(201);
	return response.json();
}

test("a dashboard is created with its owner, layout and permissions", async () => {
	const dashboard = await createDashboard(`Owner dashboard ${run}`, {
		layout: "AAA",
	});
	expect(dashboard).toMatchObject({
		name: `Owner dashboard ${run}`,
		layout: "AAA",
		shared: false,
		favourite: true,
		favouriteCount: 1,
		gadgetCount: 0,
		canEdit: true,
		sourceId: null,
	});
	expect(dashboard.owner.username).toBe(`t-${run}-owner`);
	expect(dashboard.gadgets).toEqual([]);
});

test("a private dashboard is invisible to others, a shared one is visible", async () => {
	const privateDashboard = await createDashboard(`Private ${run}`);
	const sharedDashboard = await createDashboard(`Shared ${run}`, {
		shared: true,
	});

	const visible = await request(
		"GET",
		"/api/dashboards?scope=visible",
		otherSession,
	);
	expect(visible.statusCode).toBe(200);
	const list = visible.json() as { id: string }[];
	expect(list.some((item) => item.id === privateDashboard.id)).toBe(false);
	expect(list.some((item) => item.id === sharedDashboard.id)).toBe(true);

	const hidden = await request(
		"GET",
		`/api/dashboards/${privateDashboard.id}`,
		otherSession,
	);
	expect(hidden.statusCode).toBe(404);

	const unfavourite = await request(
		"DELETE",
		`/api/dashboards/${privateDashboard.id}/favourite`,
		otherSession,
	);
	expect(unfavourite.statusCode).toBe(404);

	const otherActor = await userForSession(otherSession);
	if (!otherActor) throw new Error("The test session has no user");
	await expect(
		loadGadgetData(
			privateDashboard.id,
			{
				id: randomUUID(),
				sourceId: null,
				type: "quick-links",
				title: null,
				column: 0,
				row: 0,
				color: "",
				refreshSeconds: 0,
				config: {},
			},
			otherActor,
			0,
		),
	).rejects.toMatchObject({ status: 404 });

	const shown = await request(
		"GET",
		`/api/dashboards/${sharedDashboard.id}`,
		otherSession,
	);
	expect(shown.statusCode).toBe(200);
	expect(shown.json().canEdit).toBe(false);
});

test("only the owner or an administrator changes a dashboard", async () => {
	const dashboard = await createDashboard(`Guarded ${run}`, { shared: true });

	const denied = await request(
		"PATCH",
		`/api/dashboards/${dashboard.id}`,
		otherSession,
		{ name: "Renamed" },
	);
	expect(denied.statusCode).toBe(403);

	const allowed = await request(
		"PATCH",
		`/api/dashboards/${dashboard.id}`,
		adminSession,
		{ name: `Renamed ${run}`, description: "Changed by an administrator" },
	);
	expect(allowed.statusCode).toBe(200);
	expect(allowed.json()).toMatchObject({
		name: `Renamed ${run}`,
		description: "Changed by an administrator",
	});

	const empty = await request(
		"PATCH",
		`/api/dashboards/${dashboard.id}`,
		ownerSession,
		{},
	);
	expect(empty.statusCode).toBe(400);
});

test("gadgets are added, configured, moved between columns and deleted", async () => {
	const dashboard = await createDashboard(`Gadgets ${run}`, { layout: "AA" });

	const first = await request(
		"POST",
		`/api/dashboards/${dashboard.id}/gadgets`,
		ownerSession,
		{ type: "introduction" },
	);
	expect(first.statusCode).toBe(201);
	const introduction = first.json();
	expect(introduction).toMatchObject({
		type: "introduction",
		column: 0,
		row: 0,
		color: "color1",
		refreshSeconds: 0,
		config: { html: "" },
	});

	const second = await request(
		"POST",
		`/api/dashboards/${dashboard.id}/gadgets`,
		ownerSession,
		{ type: "assigned-to-me", config: { rows: 5 } },
	);
	expect(second.statusCode).toBe(201);
	const assigned = second.json();

	const configured = await request(
		"PATCH",
		`/api/gadgets/${assigned.id}`,
		ownerSession,
		{ color: "color3", refreshSeconds: 300, config: { rows: 3, columns: [] } },
	);
	expect(configured.statusCode).toBe(200);
	expect(configured.json()).toMatchObject({
		color: "color3",
		refreshSeconds: 300,
		config: { rows: 3, columns: [] },
	});

	const invalid = await request(
		"PATCH",
		`/api/gadgets/${assigned.id}`,
		ownerSession,
		{ config: { rows: 500 } },
	);
	expect(invalid.statusCode).toBe(400);

	const foreign = await request(
		"PUT",
		`/api/dashboards/${dashboard.id}/layout`,
		ownerSession,
		{ columns: [[introduction.id]] },
	);
	expect(foreign.statusCode).toBe(400);

	const moved = await request(
		"PUT",
		`/api/dashboards/${dashboard.id}/layout`,
		ownerSession,
		{ columns: [[], [assigned.id, introduction.id]] },
	);
	expect(moved.statusCode).toBe(200);
	const positions = moved
		.json()
		.gadgets.map((gadget: { type: string; column: number; row: number }) => [
			gadget.type,
			gadget.column,
			gadget.row,
		]);
	expect(positions).toEqual([
		["assigned-to-me", 1, 0],
		["introduction", 1, 1],
	]);

	const denied = await request(
		"PATCH",
		`/api/gadgets/${assigned.id}`,
		otherSession,
		{ title: "Mine now" },
	);
	expect(denied.statusCode).toBe(404);

	const removed = await request(
		"DELETE",
		`/api/gadgets/${assigned.id}`,
		ownerSession,
	);
	expect(removed.statusCode).toBe(204);

	const detail = await request(
		"GET",
		`/api/dashboards/${dashboard.id}`,
		ownerSession,
	);
	expect(detail.json().gadgets).toHaveLength(1);
});

test("a gadget can be added at a chosen column and row", async () => {
	const dashboard = await createDashboard(`Placement ${run}`, { layout: "AA" });

	const first = await request(
		"POST",
		`/api/dashboards/${dashboard.id}/gadgets`,
		ownerSession,
		{ type: "introduction", column: 1, row: 0 },
	);
	expect(first.statusCode).toBe(201);
	expect(first.json()).toMatchObject({ column: 1, row: 0 });

	const second = await request(
		"POST",
		`/api/dashboards/${dashboard.id}/gadgets`,
		ownerSession,
		{ type: "assigned-to-me", column: 1, row: 0 },
	);
	expect(second.statusCode).toBe(201);
	expect(second.json()).toMatchObject({ column: 1, row: 0 });

	const detail = await request(
		"GET",
		`/api/dashboards/${dashboard.id}`,
		ownerSession,
	);
	const positions = detail
		.json()
		.gadgets.map((gadget: { type: string; column: number; row: number }) => [
			gadget.type,
			gadget.column,
			gadget.row,
		]);
	expect(positions).toEqual([
		["assigned-to-me", 1, 0],
		["introduction", 1, 1],
	]);
});

test("a dashboard response only accepts a known layout", () => {
	const layout = dashboardSummarySchema.shape.layout;
	expect(layout.safeParse("AAA").success).toBe(true);
	expect(layout.safeParse("ZZ").success).toBe(false);
});

test("the imported System Dashboard is the landing page by source id", async () => {
	const byName = await createDashboard("System Dashboard", { shared: true });
	const imported = await createDashboard(`Imported landing ${run}`, {
		shared: true,
	});
	await pool.query("update dashboards set source_id = $1 where id = $2", [
		SYSTEM_DASHBOARD_ID,
		imported.id,
	]);
	await pool.query(
		`delete from dashboard_favourites
		 where user_id = (select id from users where username = $1)`,
		[`t-${run}-other`],
	);

	try {
		const home = await request("GET", "/api/dashboards/default", otherSession);
		expect(home.statusCode).toBe(200);
		expect(home.json().id).toBe(imported.id);
	} finally {
		await pool.query("delete from dashboards where id = any($1::uuid[])", [
			[byName.id, imported.id],
		]);
	}
});

test("a narrower layout pulls gadgets into the remaining columns", async () => {
	const dashboard = await createDashboard(`Narrow ${run}`, { layout: "AAA" });
	const ids: string[] = [];
	for (const column of [0, 1, 2]) {
		const added = await request(
			"POST",
			`/api/dashboards/${dashboard.id}/gadgets`,
			ownerSession,
			{ type: "introduction", column, row: 0 },
		);
		expect(added.statusCode).toBe(201);
		ids.push(added.json().id);
	}

	const changed = await request(
		"PATCH",
		`/api/dashboards/${dashboard.id}`,
		ownerSession,
		{ layout: "A" },
	);
	expect(changed.statusCode).toBe(200);
	expect(changed.json().layout).toBe("A");
	expect(
		changed
			.json()
			.gadgets.map((gadget: { id: string; column: number; row: number }) => [
				gadget.id,
				gadget.column,
				gadget.row,
			]),
	).toEqual([
		[ids[0], 0, 0],
		[ids[1], 0, 1],
		[ids[2], 0, 2],
	]);
});

test("a layout names one list per dashboard column and each gadget once", async () => {
	const dashboard = await createDashboard(`Column count ${run}`, {
		layout: "A",
	});
	const added = await request(
		"POST",
		`/api/dashboards/${dashboard.id}/gadgets`,
		ownerSession,
		{ type: "introduction" },
	);
	expect(added.statusCode).toBe(201);
	const gadget = added.json();

	const extra = await request(
		"PUT",
		`/api/dashboards/${dashboard.id}/layout`,
		ownerSession,
		{ columns: [[gadget.id], []] },
	);
	expect(extra.statusCode).toBe(400);
	expect(extra.json().error).toBe("The layout needs 1 column");

	const twice = await request(
		"PUT",
		`/api/dashboards/${dashboard.id}/layout`,
		ownerSession,
		{ columns: [[gadget.id, gadget.id]] },
	);
	expect(twice.statusCode).toBe(400);
	expect(twice.json().error).toBe("The layout names a gadget twice");
});

test("moving gadgets writes their positions in one statement", async () => {
	const dashboard = await createDashboard(`Batch ${run}`, { layout: "AA" });
	const ids: string[] = [];
	for (let index = 0; index < 4; index += 1) {
		const added = await request(
			"POST",
			`/api/dashboards/${dashboard.id}/gadgets`,
			ownerSession,
			{ type: "introduction" },
		);
		expect(added.statusCode).toBe(201);
		ids.push(added.json().id);
	}

	const updates: string[] = [];
	const counted = new WeakSet<PoolClient>();
	const countUpdates = (client: PoolClient) => {
		if (counted.has(client)) return;
		counted.add(client);
		const query = client.query.bind(client) as (...args: unknown[]) => unknown;
		client.query = ((...args: unknown[]) => {
			const statement = args[0];
			const text =
				typeof statement === "string"
					? statement
					: ((statement as { text?: string } | undefined)?.text ?? "");
			if (/update\s+.*dashboard_gadgets/i.test(text)) updates.push(text);
			return query(...args);
		}) as typeof client.query;
	};
	pool.on("acquire", countUpdates);
	try {
		const moved = await request(
			"PUT",
			`/api/dashboards/${dashboard.id}/layout`,
			ownerSession,
			{ columns: [ids.slice(0, 2), ids.slice(2)] },
		);
		expect(moved.statusCode).toBe(200);
	} finally {
		pool.off("acquire", countUpdates);
	}
	expect(updates).toHaveLength(1);
});

test("a dashboard is copied with its gadgets", async () => {
	const dashboard = await createDashboard(`Original ${run}`, {
		layout: "AB",
		shared: true,
	});
	await request(
		"POST",
		`/api/dashboards/${dashboard.id}/gadgets`,
		ownerSession,
		{
			type: "favourite-filters",
		},
	);

	const copy = await request("POST", "/api/dashboards", otherSession, {
		name: `Copy ${run}`,
		copyOf: dashboard.id,
	});
	expect(copy.statusCode).toBe(201);
	const copied = copy.json();
	expect(copied.name).toBe(`Copy ${run}`);
	expect(copied.layout).toBe("AB");
	expect(copied.gadgets).toHaveLength(1);
	expect(copied.gadgets[0].type).toBe("favourite-filters");
	expect(copied.owner.username).toBe(`t-${run}-other`);
});

test("dashboard favourites are indexed by dashboard", async () => {
	const result = await pool.query<{ indexname: string }>(
		"select indexname from pg_indexes where tablename = 'dashboard_favourites'",
	);
	expect(result.rows.map((row) => row.indexname)).toContain(
		"dashboard_favourites_dashboard_idx",
	);
});

test("favourites decide the default dashboard", async () => {
	const first = await createDashboard(`Favourite one ${run}`, { shared: true });
	const second = await createDashboard(`Favourite two ${run}`, {
		shared: true,
	});

	await pool.query(
		`delete from dashboard_favourites
		 where user_id = (select id from users where username = $1)`,
		[`t-${run}-other`],
	);

	const before = await request("GET", "/api/dashboards/default", otherSession);
	expect(before.statusCode).toBe(200);
	expect(before.json().id).not.toBe(second.id);

	await request("PUT", `/api/dashboards/${second.id}/favourite`, otherSession);
	const favourited = await request(
		"PUT",
		`/api/dashboards/${first.id}/favourite`,
		otherSession,
	);
	expect(favourited.statusCode).toBe(200);
	expect(favourited.json()).toEqual({ favourite: true, favouriteCount: 2 });

	const list = await request(
		"GET",
		"/api/dashboards?scope=favourite",
		otherSession,
	);
	expect(list.json()).toHaveLength(2);

	const defaultDashboard = await request(
		"GET",
		"/api/dashboards/default",
		otherSession,
	);
	expect(defaultDashboard.json().id).toBe(second.id);

	const removed = await request(
		"DELETE",
		`/api/dashboards/${second.id}/favourite`,
		otherSession,
	);
	expect(removed.json()).toEqual({ favourite: false, favouriteCount: 1 });

	const next = await request("GET", "/api/dashboards/default", otherSession);
	expect(next.json().id).toBe(first.id);
});

test("a dashboard is deleted with its gadgets", async () => {
	const dashboard = await createDashboard(`Doomed ${run}`);
	await request(
		"POST",
		`/api/dashboards/${dashboard.id}/gadgets`,
		ownerSession,
		{
			type: "quick-links",
		},
	);

	const denied = await request(
		"DELETE",
		`/api/dashboards/${dashboard.id}`,
		otherSession,
	);
	expect(denied.statusCode).toBe(404);

	const deleted = await request(
		"DELETE",
		`/api/dashboards/${dashboard.id}`,
		ownerSession,
	);
	expect(deleted.statusCode).toBe(204);

	const missing = await request(
		"GET",
		`/api/dashboards/${dashboard.id}`,
		ownerSession,
	);
	expect(missing.statusCode).toBe(404);
});

test("an imported dashboard is found by its Jira id", async () => {
	const dashboard = await createDashboard(`Imported ${run}`);
	await pool.query("update dashboards set source_id = $1 where id = $2", [
		`import-${run}`,
		dashboard.id,
	]);

	const bySource = await request(
		"GET",
		`/api/dashboards/import-${run}`,
		ownerSession,
	);
	expect(bySource.statusCode).toBe(200);
	expect(bySource.json().id).toBe(dashboard.id);
	expect(bySource.json().sourceId).toBe(`import-${run}`);
});
