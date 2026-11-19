import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	issues,
	issueTypes,
	priorities,
	statuses,
	watchers,
} from "../src/lib/server/schema.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const projectKey = `DG${run.slice(0, 6).toUpperCase()}`;
const projectName = `Gadget private project ${run}`;
const issueSummary = `Gadget private issue ${run}`;
const filterName = `Shared gadget filter ${run}`;

let app: TestApp;
let admin: TestUser;
let owner: TestUser;
let viewer: TestUser;
let projectId: string;
let issueId: string;
let dashboardId: string;
let filterId: string;
let schemeId: string;
const gadgets: Record<string, string> = {};

async function createProject() {
	const response = await injectAs(
		app,
		admin.session,
		"POST",
		"/api/admin/projects",
		{ name: projectName, key: projectKey, type: "software" },
	);
	expect(response.statusCode).toBe(201);
	return response.json().id as string;
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();

	admin = await makeUser(run, "admin", { admin: true });
	owner = await makeUser(run, "owner");
	viewer = await makeUser(run, "viewer");

	const [status] = await db
		.insert(statuses)
		.values({
			sourceId: `test:${run}:status`,
			name: `To Do ${run}`,
			category: "new",
		})
		.returning({ id: statuses.id });
	const [type] = await db
		.insert(issueTypes)
		.values({ sourceId: `test:${run}:type`, name: `Task ${run}` })
		.returning({ id: issueTypes.id });
	const [priority] = await db
		.insert(priorities)
		.values({
			sourceId: `test:${run}:priority`,
			name: `Medium ${run}`,
			sequence: 1,
		})
		.returning({ id: priorities.id });

	projectId = await createProject();
	const [issue] = await db
		.insert(issues)
		.values({
			sourceId: `test:${run}:issue`,
			projectId,
			number: 1,
			key: `${projectKey}-1`,
			typeId: type.id,
			statusId: status.id,
			priorityId: priority.id,
			summary: issueSummary,
			descriptionSource: issueSummary,
			assigneeId: owner.id,
			reporterId: owner.id,
			created: new Date(),
			updated: new Date(),
		})
		.returning({ id: issues.id });
	issueId = issue.id;
	await db.insert(watchers).values({
		sourceId: `test:${run}:watcher`,
		issueId,
		userId: owner.id,
	});

	const scheme = await injectAs(
		app,
		admin.session,
		"POST",
		"/api/admin/permission-schemes",
		{ name: `Gadget scheme ${run}` },
	);
	expect(scheme.statusCode).toBe(201);
	schemeId = scheme.json().scheme.id as string;
	const detail = await injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/permission-schemes/${schemeId}`,
	);
	const anyone = (
		detail.json().grants as {
			id: string;
			permissionKey: string;
			holderType: string;
		}[]
	).find(
		(grant) =>
			grant.permissionKey === "BROWSE_PROJECTS" &&
			grant.holderType === "anyone",
	);
	expect(anyone).toBeDefined();
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"DELETE",
				`/api/admin/permission-schemes/${schemeId}/grants/${anyone?.id}`,
			)
		).statusCode,
	).toBe(204);
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"POST",
				`/api/admin/permission-schemes/${schemeId}/projects`,
				{ projectId },
			)
		).statusCode,
	).toBe(200);
	expect(
		(
			await injectAs(
				app,
				admin.session,
				"POST",
				`/api/projects/${projectKey}/roles/member/actors`,
				{ actorType: "user", actorId: owner.id },
			)
		).statusCode,
	).toBe(201);

	const filter = await injectAs(app, owner.session, "POST", "/api/filters", {
		name: filterName,
		jql: `project = ${projectKey} ORDER BY key ASC`,
		shared: true,
	});
	expect(filter.statusCode).toBe(201);
	filterId = filter.json().id;
	expect(
		(
			await injectAs(
				app,
				owner.session,
				"PUT",
				`/api/filters/${filterId}/favourite`,
			)
		).statusCode,
	).toBe(200);
	expect(
		(
			await injectAs(
				app,
				viewer.session,
				"PUT",
				`/api/filters/${filterId}/favourite`,
			)
		).statusCode,
	).toBe(200);

	const dashboard = await injectAs(
		app,
		owner.session,
		"POST",
		"/api/dashboards",
		{
			name: `Gadget dashboard ${run}`,
			shared: true,
			layout: "AAA",
		},
	);
	expect(dashboard.statusCode).toBe(201);
	dashboardId = dashboard.json().id;

	const configs: Record<string, Record<string, unknown>> = {
		introduction: { html: "<p>Dashboard introduction</p>" },
		"assigned-to-me": { rows: 10 },
		"watched-issues": { rows: 10 },
		"filter-results": { filterId, rows: 10 },
		"activity-stream": { projects: [projectKey], days: 90, rows: 10 },
		"pie-chart": { statistic: "project", project: projectKey },
		"issue-statistics": { statistic: "project", project: projectKey },
		"two-dimensional": {
			xStatistic: "project",
			yStatistic: "status",
			project: projectKey,
		},
		"created-vs-resolved": { project: projectKey, days: 30 },
		"favourite-filters": {},
		"quick-links": {
			links: [{ title: "RVNA", url: "https://example.test/rvna" }],
		},
	};
	for (const [type, config] of Object.entries(configs)) {
		const response = await injectAs(
			app,
			type === "introduction" ? admin.session : owner.session,
			"POST",
			`/api/dashboards/${dashboardId}/gadgets`,
			{ type, config },
		);
		expect(response.statusCode, type).toBe(201);
		gadgets[type] = response.json().id;
	}
});

afterAll(async () => {
	if (dashboardId) {
		await pool.query("delete from dashboards where id = $1", [dashboardId]);
	}
	if (filterId)
		await pool.query("delete from filters where id = $1", [filterId]);
	if (schemeId) {
		await pool.query("delete from permission_schemes where id = $1", [
			schemeId,
		]);
	}
	if (projectId) {
		await pool.query("delete from projects where id = $1", [projectId]);
	}
	await pool.query("delete from audit_log where actor_id = $1", [admin.id]);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

async function gadgetData(session: string, type: string) {
	const response = await injectAs(
		app,
		session,
		"GET",
		`/api/gadgets/${gadgets[type]}/data`,
	);
	expect(response.statusCode, type).toBe(200);
	return response.json();
}

function totalIssues(data: { issueList?: { total: number } }) {
	return data.issueList?.total ?? 0;
}

test("every gadget type shows a viewer of a shared dashboard only their own projects", async () => {
	const ownerAssigned = await gadgetData(owner.session, "assigned-to-me");
	expect(totalIssues(ownerAssigned)).toBe(1);
	const ownerWatched = await gadgetData(owner.session, "watched-issues");
	expect(totalIssues(ownerWatched)).toBe(1);
	const ownerFilter = await gadgetData(owner.session, "filter-results");
	expect(totalIssues(ownerFilter)).toBe(1);
	const ownerActivity = await gadgetData(owner.session, "activity-stream");
	expect(ownerActivity.activity.length).toBeGreaterThan(0);
	const ownerPie = await gadgetData(owner.session, "pie-chart");
	expect(ownerPie.slices).toEqual(
		expect.arrayContaining([expect.objectContaining({ label: projectName })]),
	);
	const ownerStatistics = await gadgetData(owner.session, "issue-statistics");
	expect(ownerStatistics.slices).toEqual(
		expect.arrayContaining([expect.objectContaining({ label: projectName })]),
	);
	const ownerMatrix = await gadgetData(owner.session, "two-dimensional");
	expect(ownerMatrix.matrix.total).toBe(1);
	const ownerSeries = await gadgetData(owner.session, "created-vs-resolved");
	expect(
		ownerSeries.series.created.reduce(
			(sum: number, value: number) => sum + value,
			0,
		),
	).toBe(1);
	const ownerFavourites = await gadgetData(owner.session, "favourite-filters");
	expect(ownerFavourites.filters).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ name: filterName, total: 1 }),
		]),
	);

	const viewerAssigned = await gadgetData(viewer.session, "assigned-to-me");
	expect(totalIssues(viewerAssigned)).toBe(0);
	const viewerWatched = await gadgetData(viewer.session, "watched-issues");
	expect(totalIssues(viewerWatched)).toBe(0);
	const viewerFilter = await gadgetData(viewer.session, "filter-results");
	expect(totalIssues(viewerFilter)).toBe(0);
	const viewerActivity = await gadgetData(viewer.session, "activity-stream");
	expect(viewerActivity.activity).toEqual([]);
	const viewerPie = await gadgetData(viewer.session, "pie-chart");
	expect(viewerPie.slices).toEqual([]);
	const viewerStatistics = await gadgetData(viewer.session, "issue-statistics");
	expect(viewerStatistics.slices).toEqual([]);
	const viewerMatrix = await gadgetData(viewer.session, "two-dimensional");
	expect(viewerMatrix.matrix).toMatchObject({
		columns: [],
		rows: [],
		totals: [],
		total: 0,
	});
	const viewerSeries = await gadgetData(viewer.session, "created-vs-resolved");
	expect(
		viewerSeries.series.created.every((value: number) => value === 0),
	).toBe(true);
	expect(
		viewerSeries.series.resolved.every((value: number) => value === 0),
	).toBe(true);
	const viewerFavourites = await gadgetData(
		viewer.session,
		"favourite-filters",
	);
	expect(viewerFavourites.filters).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ name: filterName, total: 0 }),
		]),
	);
	const viewerQuickLinks = await gadgetData(viewer.session, "quick-links");
	expect(viewerQuickLinks.links).toEqual([
		{ title: "RVNA", url: "https://example.test/rvna" },
	]);
	const viewerIntroduction = await gadgetData(viewer.session, "introduction");
	expect(viewerIntroduction.html).toContain("Dashboard introduction");

	const exposed = JSON.stringify(
		[
			viewerAssigned,
			viewerWatched,
			viewerFilter,
			viewerActivity,
			viewerPie,
			viewerStatistics,
			viewerMatrix,
			viewerSeries,
			viewerFavourites,
			viewerQuickLinks,
			viewerIntroduction,
		].map(({ config: _config, ...data }) => data),
	);
	for (const secret of [
		projectKey,
		projectName,
		issueSummary,
		`${projectKey}-1`,
	]) {
		expect(exposed).not.toContain(secret);
	}
});
