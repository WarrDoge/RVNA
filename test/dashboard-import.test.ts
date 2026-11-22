import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	type DashboardDataset,
	fetchDashboardDataset,
	type JiraDashboard,
	type JiraDashboardGadget,
	type JiraFilter,
} from "../src/importer/dashboards.ts";
import {
	gadgetType,
	importDashboardDataset,
	mapColumns,
	mapDashboard,
	mapFilter,
	mapFilterShares,
	mapGadgetConfig,
	mapGadgets,
	summarizeFilterShares,
} from "../src/importer/dashboards-import.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = Math.random().toString(36).slice(2, 8);
let app: TestApp;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await login(app, {
		sub: `sub-dash-import-${run}`,
		username: `t-${run}-import`,
		name: "Import Owner",
		groups: [],
	});
});

afterAll(async () => {
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function gadget(
	id: string,
	title: string,
	column: number,
	fields: Record<string, string> = {},
): JiraDashboardGadget {
	return {
		id,
		title,
		column,
		color: "color1",
		userPrefs: {
			fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
		},
	};
}

const dashboard: JiraDashboard = {
	id: `test-dash-${run}`,
	title: "Test Dashboard",
	layout: "AB",
	gadgets: [
		gadget(`test-gadget-${run}-1`, "Introduction", 0),
		gadget(`test-gadget-${run}-2`, "Assigned to Me", 0, {
			num: "5",
			columnNames: "issuetype|issuekey|summary|priority",
			refresh: "15",
		}),
		gadget(`test-gadget-${run}-3`, "Issue Statistics", 1, {
			statType: "priorities",
			projectOrFilterId: "project-10000",
			refresh: "false",
		}),
		gadget(`test-gadget-${run}-4`, "Filter Results", 1, {
			projectOrFilterId: "filter-10100",
			columnNames: "--Default--",
			num: "20",
		}),
		gadget(`test-gadget-${run}-5`, "Agile Wallboard Gadget", 1),
	],
};

const lookups = {
	projectKeyBySourceId: new Map([["10000", "TEST"]]),
	filterIdBySourceId: new Map([["10100", "filter-uuid"]]),
	fallbackUserId: "user-uuid",
};

test("Jira gadget titles map to gadget types, unknown ones keep their name", () => {
	expect(gadgetType("Introduction")).toBe("introduction");
	expect(gadgetType("Assigned to Me")).toBe("assigned-to-me");
	expect(gadgetType("Two Dimensional Filter Statistics")).toBe(
		"two-dimensional",
	);
	expect(gadgetType("Created vs Resolved Chart")).toBe("created-vs-resolved");
	expect(gadgetType("Agile Wallboard Gadget")).toBe("agile-wallboard-gadget");
});

test("Jira column lists map to navigator columns and drop what we do not have", () => {
	expect(mapColumns("issuetype|issuekey|summary|priority|project")).toEqual([
		"type",
		"key",
		"summary",
		"priority",
		"project",
	]);
	expect(mapColumns("--Default--")).toEqual([]);
	expect(mapColumns("summary|customfield_10107|progress|nonsense")).toEqual([
		"summary",
		"customfield_10107",
	]);
});

function gadgetAt(index: number) {
	const found = dashboard.gadgets[index];
	if (!found) throw new Error(`The fixture has no gadget ${index}`);
	return found;
}

test("gadget preferences become our gadget configuration", () => {
	const assigned = mapGadgetConfig(gadgetAt(1), "assigned-to-me", lookups);
	expect(assigned).toEqual({
		columns: ["type", "key", "summary", "priority"],
		rows: 5,
	});

	const statistics = mapGadgetConfig(gadgetAt(2), "issue-statistics", lookups);
	expect(statistics).toEqual({
		statistic: "priority",
		filterId: null,
		project: "TEST",
	});

	const filtered = mapGadgetConfig(gadgetAt(3), "filter-results", lookups);
	expect(filtered).toEqual({
		filterId: "filter-uuid",
		columns: [],
		rows: 20,
	});

	const activity = mapGadgetConfig(
		{
			...gadget("g", "Activity Stream", 0),
			userPrefs: {
				fields: [
					{
						name: "rules",
						value:
							"%7B%22providers%22%3A%5B%7B%22provider%22%3A%22streams%22%2C%22rules%22%3A%5B%7B%22rule%22%3A%22key%22%2C%22value%22%3A%5B%22ABC%22%5D%7D%5D%7D%5D%7D",
					},
					{ name: "numofentries", value: "5" },
				],
			},
		},
		"activity-stream",
		lookups,
	);
	expect(activity).toEqual({ projects: ["ABC"], users: [], days: 7, rows: 5 });
});

test("a two-dimensional gadget keeps its two statistics different after mapping", () => {
	const mapped = mapGadgetConfig(
		gadget("g", "Two Dimensional Filter Statistics", 0, {
			xstat: "versions",
			ystat: "fixfor",
		}),
		"two-dimensional",
		lookups,
	) as { xStatistic: string; yStatistic: string };
	expect(mapped.xStatistic).toBe("fixVersion");
	expect(mapped.yStatistic).not.toBe(mapped.xStatistic);

	const same = mapGadgetConfig(
		gadget("g", "Two Dimensional Filter Statistics", 0, {
			xstat: "statuses",
			ystat: "statuses",
		}),
		"two-dimensional",
		lookups,
	) as { xStatistic: string; yStatistic: string };
	expect(same.yStatistic).not.toBe(same.xStatistic);
});

test("gadgets keep Jira's column order and their refresh interval", () => {
	const mapped = mapGadgets(dashboard, lookups);
	expect(
		mapped.map((row) => [row.type, row.columnIndex, row.rowIndex]),
	).toEqual([
		["introduction", 0, 0],
		["assigned-to-me", 0, 1],
		["issue-statistics", 1, 0],
		["filter-results", 1, 1],
		["agile-wallboard-gadget", 1, 2],
	]);
	expect(mapped[1]?.refreshSeconds).toBe(900);
	expect(mapped[2]?.refreshSeconds).toBe(0);
	expect(mapped[4]?.title).toBe("Agile Wallboard Gadget");
	expect(mapped[0]?.title).toBeNull();
});

test("a malformed gadget column falls back to the first column", () => {
	const mapped = mapGadgets(
		{
			...dashboard,
			gadgets: [{ ...gadget("g", "Introduction", 0), column: Number.NaN }],
		},
		lookups,
	);
	expect(mapped[0]?.columnIndex).toBe(0);
});

test("a dashboard and a filter map to rows with their Jira id", () => {
	expect(mapDashboard(dashboard, "user-uuid")).toEqual({
		sourceId: `test-dash-${run}`,
		name: "Test Dashboard",
		description: null,
		ownerId: "user-uuid",
		layout: "AB",
		shared: false,
	});

	expect(
		mapFilter(
			{
				id: "10100",
				name: "Filter",
				jql: "project = TEST",
				owner: { name: "someone" },
				sharePermissions: [{ type: "group" }],
			},
			"user-uuid",
		),
	).toEqual({
		sourceId: "10100",
		name: "Filter",
		description: null,
		jql: "project = TEST",
		ownerId: "user-uuid",
		columns: [],
		shared: false,
	});
});

test("the import is idempotent and keeps per-table counts", async () => {
	const dataset: DashboardDataset = {
		owner: `t-${run}-import`,
		dashboards: [dashboard],
		filters: [
			{
				id: `test-filter-${run}`,
				name: `Imported filter ${run}`,
				description: "From a fixture",
				jql: "project = TEST ORDER BY key ASC",
				owner: { name: `t-${run}-import` },
				sharePermissions: [{ type: "project" }],
			},
		],
		favouriteFilters: [`test-filter-${run}`],
		favouriteDashboards: [`test-dash-${run}`],
	};

	const first = await importDashboardDataset(dataset);
	expect(first.filters).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
	expect(first.dashboards).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
	expect(first.dashboard_gadgets).toEqual({
		inserted: 5,
		updated: 0,
		unchanged: 0,
	});
	expect(first.filter_favourites?.inserted).toBe(1);
	expect(first.dashboard_favourites?.inserted).toBe(1);

	const second = await importDashboardDataset(dataset);
	expect(second.filters).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
	expect(second.dashboards).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
	expect(second.dashboard_gadgets).toEqual({
		inserted: 0,
		updated: 0,
		unchanged: 5,
	});
	expect(second.filter_favourites?.unchanged).toBe(1);
	expect(second.dashboard_favourites?.unchanged).toBe(1);

	const rows = await pool.query<{
		name: string;
		layout: string;
		source_id: string;
	}>("select name, layout, source_id from dashboards where source_id = $1", [
		`test-dash-${run}`,
	]);
	expect(rows.rows).toHaveLength(1);
	expect(rows.rows[0]).toMatchObject({
		name: "Test Dashboard",
		layout: "AB",
		source_id: `test-dash-${run}`,
	});

	const gadgets = await pool.query<{
		type: string;
		column_index: number;
		row_index: number;
	}>(
		`select type, column_index, row_index from dashboard_gadgets
		 where source_id like $1 order by column_index, row_index`,
		[`test-gadget-${run}-%`],
	);
	expect(gadgets.rows.map((row) => row.type)).toEqual([
		"introduction",
		"assigned-to-me",
		"issue-statistics",
		"filter-results",
		"agile-wallboard-gadget",
	]);

	const filter = await pool.query<{ shared: boolean; source_id: string }>(
		"select shared, source_id from filters where source_id = $1",
		[`test-filter-${run}`],
	);
	expect(filter.rows[0]?.shared).toBe(false);
});

test("the dataset fetch reads dashboards, gadgets and filters through the client", async () => {
	const calls: string[] = [];
	const responses: Record<string, unknown> = {
		"/rest/api/2/myself": { name: "importer" },
		"/rest/api/2/dashboard": {
			dashboards: [{ id: "1", name: "One" }],
			total: 1,
		},
		"/rest/dashboards/1.0/1": {
			id: "1",
			title: "One",
			layout: "AA",
			gadgets: [
				{
					id: "10",
					title: "Assigned to Me",
					column: 0,
					color: "color2",
					userPrefs: { fields: [{ name: "num", value: "3" }] },
				},
			],
		},
		"/rest/api/2/filter/favourite": [{ id: "20" }],
		"/rest/api/2/filter/20": {
			id: "20",
			name: "Favourite",
			jql: "project = ONE",
			owner: { name: "importer" },
			sharePermissions: [],
		},
	};
	const client = {
		async getJson(path: string) {
			calls.push(path);
			const value = responses[path];
			if (value === undefined)
				throw Object.assign(new Error("404"), { status: 404 });
			return value;
		},
		async request(_method: string, path: string) {
			calls.push(path);
			return {
				async text() {
					return `<input data-id="entityId" value="20"/>`;
				},
			};
		},
	};

	const dataset = await fetchDashboardDataset(
		client as unknown as Parameters<typeof fetchDashboardDataset>[0],
		{ privateApis: true },
	);
	expect(dataset.owner).toBe("importer");
	expect(dataset.dashboards).toHaveLength(1);
	expect(dataset.dashboards[0]?.gadgets[0]?.color).toBe("color2");
	expect(dataset.filters.map((filter) => filter.id)).toEqual(["20"]);
	expect(dataset.favouriteFilters).toEqual(["20"]);
	expect(calls).toContain("/rest/dashboards/1.0/1");
	expect(calls).toContain("/secure/ManageFilters.jspa");
});

const filterBase = {
	jql: "project = TEST",
	owner: { name: "someone" },
};

test("Jira share permissions map to the app's shares", () => {
	const shares = mapFilterShares({
		...filterBase,
		id: "1",
		name: "Mixed",
		sharePermissions: [
			{ type: "project", project: { id: "10000", key: "TEST" } },
			{
				type: "project",
				project: { id: "10001", key: "ROLE" },
				role: { id: "1", name: "Developers" },
			},
			{ type: "group", group: { name: "devs" } },
			{ type: "user" },
		],
	});
	expect(shares).toEqual({
		everyone: false,
		projectKeys: ["TEST", "ROLE"],
		groupNames: ["devs"],
		roleShares: 1,
		ignored: ["user"],
	});
	for (const type of ["global", "loggedin", "authenticated"]) {
		expect(
			mapFilterShares({
				...filterBase,
				id: "2",
				name: "A",
				sharePermissions: [{ type }],
			}).everyone,
		).toBe(true);
	}
	expect(
		mapFilterShares(
			{
				...filterBase,
				id: "3",
				name: "By id",
				sharePermissions: [{ type: "project", project: { id: "10000" } }],
			},
			new Map([["10000", "TEST"]]),
		).projectKeys,
	).toEqual(["TEST"]);
	expect(
		summarizeFilterShares([
			{ ...filterBase, id: "4", name: "None", sharePermissions: [] },
			{
				...filterBase,
				id: "5",
				name: "Project",
				sharePermissions: [{ type: "project", project: { key: "TEST" } }],
			},
		]),
	).toMatchObject({ filters: 2, project: 1, ownerOnly: 1, everyone: 0 });
});

test("a role share on an unknown project does not count as a project", () => {
	const summary = summarizeFilterShares([
		{
			...filterBase,
			id: "6",
			name: "Unknown role",
			sharePermissions: [
				{
					type: "project",
					project: { id: "999" },
					role: { id: "1", name: "Developers" },
				},
			],
		},
	]);
	expect(summary).toMatchObject({
		filters: 1,
		project: 0,
		projectRole: 0,
		ignored: 1,
		ownerOnly: 1,
	});
});

describe("shares of imported filters and dashboards", () => {
	const projectKey = `SH${run.toUpperCase()}`;
	const memberGroup = `t-${run}-members`;
	const sharedGroup = `t-${run}-readers`;
	const owner = `t-${run}-share-owner`;
	const names = {
		project: `Share project ${run}`,
		role: `Share role ${run}`,
		group: `Share group ${run}`,
		global: `Share global ${run}`,
		none: `Share none ${run}`,
	};
	let outsider: string;
	let member: string;
	let reader: string;
	let admin: string;
	let schemeId: string;

	function dataset(sharesOf: (name: string) => JiraFilter["sharePermissions"]) {
		return {
			owner,
			dashboards: [
				{
					...dashboard,
					id: `share-dash-${run}`,
					title: `Share dashboard ${run}`,
				},
			],
			filters: Object.values(names).map((name) => ({
				id: `share-filter-${name}`,
				name,
				jql: `project = ${projectKey}`,
				owner: { name: owner },
				sharePermissions: sharesOf(name),
			})),
			favouriteFilters: [],
			favouriteDashboards: [],
		} satisfies DashboardDataset;
	}

	const jiraShares = (name: string): JiraFilter["sharePermissions"] => {
		if (name === names.project)
			return [{ type: "project", project: { id: "1", key: projectKey } }];
		if (name === names.role)
			return [
				{
					type: "project",
					project: { id: "1", key: projectKey },
					role: { id: "10", name: "Developers" },
				},
			];
		if (name === names.group)
			return [{ type: "group", group: { name: sharedGroup } }];
		if (name === names.global) return [{ type: "global" }];
		return [];
	};

	async function listed(session: string) {
		const response = await app.inject({
			method: "GET",
			url: `/api/filters?scope=search&query=${encodeURIComponent(`Share `)}`,
			cookies: { sid: session },
		});
		return (response.json() as { name: string }[])
			.map((row) => row.name)
			.filter((name) => name.endsWith(run))
			.sort();
	}

	async function dashboardsOf(session: string) {
		const response = await app.inject({
			method: "GET",
			url: "/api/dashboards",
			cookies: { sid: session },
		});
		return (response.json() as { name: string }[])
			.map((row) => row.name)
			.filter((name) => name.endsWith(run));
	}

	beforeAll(async () => {
		const login_ = async (user: string, groups: string[]) =>
			(
				await login(app, {
					sub: `${run}-${user}`,
					username: `t-${run}-${user}`,
					name: user,
					groups,
				})
			).sessionId as string;
		await login(app, {
			sub: `${run}-owner`,
			username: owner,
			name: "Owner",
			groups: [],
		});
		outsider = await login_("outsider", []);
		member = await login_("member", [memberGroup]);
		reader = await login_("reader", [sharedGroup]);
		admin = await login_("admin", [adminGroup()]);

		const [project] = await pool
			.query<{ id: string }>(
				"insert into projects (source_id, key, name, project_type, last_issue_number) values ($1, $2, $2, 'software', 0) returning id",
				[`share-project-${run}`, projectKey],
			)
			.then((result) => result.rows);
		const scheme = await pool.query<{ id: string }>(
			"insert into permission_schemes (source_id, name, project_ids, raw) values ($1, $1, $2::jsonb, '{}'::jsonb) returning id",
			[`share-scheme-${run}`, JSON.stringify([project?.id])],
		);
		schemeId = scheme.rows[0]?.id as string;
		await pool.query(
			"insert into permission_grants (source_id, scheme_id, permission_key, holder_type, holder_parameter, raw) values ($1, $2, 'BROWSE_PROJECTS', 'group', $3, '{}'::jsonb)",
			[`share-grant-${run}`, schemeId, memberGroup],
		);
	});

	afterAll(async () => {
		await pool.query("delete from filters where source_id like $1", [
			"share-filter-%",
		]);
		await pool.query("delete from dashboards where source_id = $1", [
			`share-dash-${run}`,
		]);
		await pool.query("delete from permission_schemes where source_id = $1", [
			`share-scheme-${run}`,
		]);
		await pool.query("delete from projects where key = $1", [projectKey]);
	});

	test("project, role, group and global shares become the app's shares", async () => {
		const first = await importDashboardDataset(dataset(jiraShares));
		expect(first.filter_shares).toEqual({
			inserted: 3,
			updated: 0,
			unchanged: 0,
		});

		const rows = await pool.query<{
			name: string;
			shared: boolean;
			shares: number;
		}>(
			`select f.name, f.shared, (select count(*)::int from filter_shares s where s.filter_id = f.id) as shares
			 from filters f where f.source_id like 'share-filter-%' order by f.name`,
		);
		expect(
			Object.fromEntries(
				rows.rows.map((row) => [row.name, [row.shared, row.shares]]),
			),
		).toEqual({
			[names.project]: [false, 1],
			[names.role]: [false, 1],
			[names.group]: [false, 1],
			[names.global]: [true, 0],
			[names.none]: [false, 0],
		});

		const second = await importDashboardDataset(dataset(jiraShares));
		expect(second.filter_shares).toEqual({
			inserted: 0,
			updated: 0,
			unchanged: 3,
		});
	});

	test("a user with no access sees no filter or dashboard of others", async () => {
		expect(await listed(outsider)).toEqual([names.global]);
		expect(await dashboardsOf(outsider)).toEqual([]);

		expect(await listed(member)).toEqual(
			[names.global, names.project, names.role].sort(),
		);
		expect(await listed(reader)).toEqual([names.global, names.group].sort());
		expect(await listed(admin)).toEqual(Object.values(names).sort());
		expect(await dashboardsOf(admin)).toEqual([`Share dashboard ${run}`]);
		expect(await dashboardsOf(member)).toEqual([]);
	});

	test("a share Jira stops listing is removed", async () => {
		const result = await importDashboardDataset(
			dataset((name) => (name === names.project ? [] : jiraShares(name))),
		);
		expect(result.filter_shares).toEqual({
			inserted: 0,
			updated: 1,
			unchanged: 2,
		});
		expect(await listed(member)).toEqual([names.global, names.role].sort());
	});

	test("an administrator's choice to share a dashboard survives a later import", async () => {
		const id = (
			await pool.query<{ id: string }>(
				"select id from dashboards where source_id = $1",
				[`share-dash-${run}`],
			)
		).rows[0]?.id;
		const shared = await app.inject({
			method: "PATCH",
			url: `/api/dashboards/${id}`,
			cookies: { sid: admin },
			headers: { "x-requested-with": "rvna" },
			payload: { shared: true },
		});
		expect(shared.statusCode).toBe(200);
		expect(await dashboardsOf(outsider)).toEqual([`Share dashboard ${run}`]);

		const again = await importDashboardDataset(dataset(jiraShares));
		expect(again.dashboards).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
		expect(await dashboardsOf(outsider)).toEqual([`Share dashboard ${run}`]);
	});
});

describe("the System Dashboard", () => {
	const owner = `t-${run}-sys-owner`;
	let outsider: string;
	let outsiderId: string;

	const system = { ...dashboard, id: "10000", title: "System Dashboard" };
	const privateOne = {
		...dashboard,
		id: `sys-private-${run}`,
		title: `Private dashboard ${run}`,
		gadgets: [],
	};
	const dataset = (): DashboardDataset => ({
		owner,
		dashboards: [system, privateOne],
		filters: [],
		favouriteFilters: [],
		favouriteDashboards: [],
	});
	const call = (
		method: "GET" | "PATCH" | "POST" | "DELETE",
		url: string,
		payload?: unknown,
	) =>
		app.inject({
			method,
			url,
			cookies: { sid: outsider },
			headers: { "x-requested-with": "rvna" },
			payload: payload as never,
		});

	beforeAll(async () => {
		await login(app, {
			sub: `${run}-sys-owner`,
			username: owner,
			name: "Owner",
			groups: [],
		});
		const user = await login(app, {
			sub: `${run}-sys-outsider`,
			username: `t-${run}-sys-outsider`,
			name: "Outsider",
			groups: [],
		});
		outsider = user.sessionId as string;
		outsiderId = (
			await app.inject({
				method: "GET",
				url: "/api/me",
				cookies: { sid: outsider },
			})
		).json().id;
		// A database with an imported System Dashboard keeps it aside during the test.
		await pool.query(
			"update dashboards set source_id = source_id || ':aside', name = name || ' (aside)', shared = false where source_id = '10000'",
		);
	});

	afterAll(async () => {
		await pool.query(
			"delete from dashboards where source_id = '10000' or source_id = $1",
			[privateOne.id],
		);
		await pool.query(
			"update dashboards set source_id = '10000', name = replace(name, ' (aside)', ''), shared = true where source_id = '10000:aside'",
		);
	});

	test("every signed-in user lands on it, nobody but its owner and administrators edits it, and a user with no dashboard still gets an answer", async () => {
		expect(mapDashboard(system, "u").shared).toBe(true);
		expect(mapDashboard(privateOne, "u").shared).toBe(false);

		await importDashboardDataset(dataset());
		const shared = await pool.query<{ source_id: string; shared: boolean }>(
			"select source_id, shared from dashboards where source_id = any($1) order by source_id",
			[["10000", privateOne.id]],
		);
		expect(shared.rows.map((row) => [row.source_id, row.shared])).toEqual([
			["10000", true],
			[privateOne.id, false],
		]);

		const listed = (await call("GET", "/api/dashboards")).json() as {
			name: string;
		}[];
		expect(listed.map((row) => row.name)).toEqual(["System Dashboard"]);
		const home = await call("GET", "/api/dashboards/default");
		expect(home.statusCode).toBe(200);
		const body = home.json() as {
			id: string;
			name: string;
			gadgets: { id: string }[];
			canEdit: boolean;
		};
		expect(body.name).toBe("System Dashboard");
		expect(body.gadgets.length).toBeGreaterThan(0);
		expect(body.canEdit).toBe(false);

		expect(
			(await call("PATCH", `/api/dashboards/${body.id}`, { shared: false }))
				.statusCode,
		).toBe(403);
		expect(
			(await call("DELETE", `/api/dashboards/${body.id}`)).statusCode,
		).toBe(403);
		expect(
			(
				await call("POST", `/api/dashboards/${body.id}/gadgets`, {
					type: "introduction",
				})
			).statusCode,
		).toBe(403);
		expect(
			(await call("DELETE", `/api/gadgets/${body.gadgets[0]?.id}`)).statusCode,
		).toBe(403);

		// An administrator may not leave it private through a later import either.
		await pool.query(
			"update dashboards set shared = false where source_id = '10000'",
		);
		await importDashboardDataset(dataset());
		expect((await call("GET", "/api/dashboards/default")).statusCode).toBe(200);

		// Without a System Dashboard the user sees no dashboard: the API answers 404 and the page shows its empty state.
		await pool.query("delete from dashboards where source_id = '10000'");
		expect((await call("GET", "/api/dashboards")).json()).toEqual([]);
		expect((await call("GET", "/api/dashboards/default")).statusCode).toBe(404);
		expect(outsiderId).toBeTruthy();
	});
});

test("the dataset fetch pages through more than one page of dashboards", async () => {
	const all = [
		{ id: "1", name: "One" },
		{ id: "2", name: "Two" },
		{ id: "3", name: "Three" },
	];
	const favourites = [
		{ id: "1", name: "One" },
		{ id: "3", name: "Three" },
	];
	const client = {
		async getJson(
			path: string,
			params?: Record<string, string | number | boolean | undefined>,
		) {
			if (path === "/rest/api/2/myself") return { name: "importer" };
			if (path === "/rest/api/2/dashboard") {
				const source = params?.filter === "favourite" ? favourites : all;
				const start = Number(params?.startAt ?? 0);
				const size = params?.filter === "favourite" ? 1 : 2;
				return {
					dashboards: source.slice(start, start + size),
					total: source.length,
				};
			}
			if (path.startsWith("/rest/dashboards/1.0/")) {
				const id = path.split("/").at(-1);
				return { id, title: `Dashboard ${id}`, layout: "AA", gadgets: [] };
			}
			if (path === "/rest/api/2/filter/favourite") return [];
			throw Object.assign(new Error("404"), { status: 404 });
		},
		async request() {
			return {
				async text() {
					return "";
				},
			};
		},
	};

	const dataset = await fetchDashboardDataset(
		client as unknown as Parameters<typeof fetchDashboardDataset>[0],
		{ privateApis: true },
	);
	expect(dataset.dashboards.map((dashboard) => dashboard.id)).toEqual([
		"1",
		"2",
		"3",
	]);
	expect(dataset.favouriteDashboards).toEqual(["1", "3"]);
});
