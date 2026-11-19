import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { isAdminPagePath } from "../src/lib/server/admin/index.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	attachments,
	boards,
	comments,
	components,
	filterShares,
	filters,
	issueLinks,
	issueViews,
	linkTypes,
	notifications,
	permissionSchemes,
	sprints,
	users,
	versions,
	worklogs,
} from "../src/lib/server/schema.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
	type SeedResult,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import { type AppRoute, allAppRoutes, routeKey } from "./route-inventory.ts";
import type { TestApp } from "./server.ts";

const run = fixtureRun();
const visibleKey = fixtureKey(run);
const invisibleKey = `ZZ${run.slice(0, 5).toUpperCase()}`;
const secretSummary = `Secret enforcement issue ${run}`;
const secretComponent = `Secret component ${run}`;
const secretVersion = `Secret version ${run}`;
const secretAttachment = `secret-${run}.txt`;
const secretFilter = `Secret filter ${run}`;
const secretLinkType = `Secret link ${run}`;
const secretBoard = `Secret board ${run}`;
const secretSprint = `Secret sprint ${run}`;

let app: TestApp;
let client: Client;
let session: string;
let userId: string;
let otherUserId: string;
let visible: SeedResult;
let invisible: SeedResult;
let invisibleIssueId: string;
let visibleIssueId: string;
let componentId: string;
let versionId: string;
let attachmentId: string;
let linkId: string;
let filterId: string;
let notificationId: string;
let boardRapidViewId: number;
let sprintId: string;

const allowList = new Set([
	"GET /api/health",
	"GET /api/health/live",
	"GET /login.jsp",
	"GET /login",
	"GET /sk-charts",
	"GET /sk-dnd",
	"GET /sk-editor",
	"GET /sk-jql",
	"GET /sk-kit",
	"GET /sk-workflow",
	"POST /login.jsp",
	"GET /secure/CreateIssue!default.jspa",
	"GET /secure/BrowseProjects.jspa",
	"GET /secure/ManageFilters.jspa",
	"POST /secure/ManageFilters.jspa",
	"GET /search",
	"GET /secure/ViewProfile.jspa",
	"POST /secure/ViewProfile.jspa",
	"GET /sk-sidebar",
	"GET /api/me",
	"GET /api/me/tokens",
	"POST /api/me/tokens",
	"DELETE /api/me/tokens/:id",
	"GET /api/me/notification-settings",
	"PUT /api/me/notification-settings",
	"GET /api/link-types",
	"GET /api/fields",
	"GET /api/users",
	"GET /api/profile/messenger",
	"POST /api/profile/messenger",
	"DELETE /api/profile/messenger",
	"GET /api/avatars/users/:id",
	"GET /api/navigator/preferences",
	"PUT /api/navigator/preferences",
	"GET /auth/login",
	"GET /auth/callback",
	"POST /auth/logout",
]);

const handled = new Set([
	"GET /secure/Dashboard.jspa",
	"POST /secure/Dashboard.jspa",
	"GET /secure/ConfigurePortalPages!default.jspa",
	"POST /secure/ConfigurePortalPages!default.jspa",
	"GET /api/projects",
	"GET /api/projects/:key",
	"GET /api/projects/:key/roles",
	"POST /api/projects/:key/roles/:roleId/actors",
	"DELETE /api/projects/:key/roles/:roleId/actors/:actorId",
	"PATCH /api/projects/:key",
	"GET /api/projects/:key/issues",
	"POST /api/projects/:key/components",
	"POST /api/projects/:key/versions",
	"PATCH /api/components/:id",
	"DELETE /api/components/:id",
	"PATCH /api/versions/:id",
	"DELETE /api/versions/:id",
	"POST /api/issues",
	"POST /api/issues/:key/clone",
	"GET /api/issues/recent",
	"GET /api/issues/:key",
	"PATCH /api/issues/:key",
	"DELETE /api/issues/:key",
	"POST /api/issues/:key/transitions",
	"GET /api/issues/:key/comments",
	"POST /api/issues/:key/comments",
	"PATCH /api/issues/:key/comments/:id",
	"DELETE /api/issues/:key/comments/:id",
	"GET /api/issues/:key/history",
	"GET /api/issues/:key/worklogs",
	"POST /api/issues/:key/worklogs",
	"DELETE /api/issues/:key/worklogs/:id",
	"PUT /api/issues/:key/watch",
	"DELETE /api/issues/:key/watch",
	"GET /api/issues/:key/watchers",
	"POST /api/issues/:key/watchers",
	"DELETE /api/issues/:key/watchers/:userId",
	"POST /api/issues/:key/links",
	"POST /api/issues/:key/attachments",
	"DELETE /api/issue-links/:id",
	"GET /api/attachments/:id",
	"DELETE /api/attachments/:id",
	"GET /api/avatars/projects/:id",
	"GET /api/notifications",
	"GET /api/notifications/unread",
	"POST /api/notifications/mark-all-read",
	"POST /api/notifications/:id/read",
	"GET /api/search",
	"POST /api/search",
	"GET /api/search/issues",
	"GET /api/search/export",
	"GET /api/filters",
	"GET /api/filters/share-groups",
	"POST /api/filters",
	"GET /api/filters/:id",
	"PATCH /api/filters/:id",
	"DELETE /api/filters/:id",
	"PUT /api/filters/:id/favourite",
	"DELETE /api/filters/:id/favourite",
	"GET /api/quicksearch",
	"GET /api/jql/suggest",
	"POST /api/integrations/gitlab/webhook",
	"GET /api/issues/:key/development",
	"POST /api/issues/:key/view",
	"POST /api/me/password",
	"GET /api/boards",
	"POST /api/boards",
	"GET /api/boards/:rapidViewId",
	"PATCH /api/boards/:rapidViewId",
	"DELETE /api/boards/:rapidViewId",
	"PUT /api/boards/:rapidViewId/columns",
	"PUT /api/boards/:rapidViewId/swimlanes",
	"POST /api/boards/:rapidViewId/sprints",
	"PUT /api/boards/:rapidViewId/quick-filters",
	"GET /api/boards/:rapidViewId/data",
	"GET /api/boards/:rapidViewId/backlog",
	"POST /api/boards/:rapidViewId/move",
	"GET /api/boards/:rapidViewId/reports/sprints",
	"GET /api/boards/:rapidViewId/reports/sprint-report",
	"GET /api/boards/:rapidViewId/reports/burndown",
	"GET /api/boards/:rapidViewId/reports/velocity",
	"GET /api/boards/:rapidViewId/reports/cumulative-flow",
	"PATCH /api/sprints/:id",
	"DELETE /api/sprints/:id",
	"POST /api/sprints/:id/start",
	"POST /api/sprints/:id/complete",
	"POST /api/sprints/:id/move",
	"GET /api/servicedesk/portals/:id/requests/:key",
	"POST /api/servicedesk/portals/:id/requests/:key/comments",
	"GET /api/servicedesk/projects/:key/settings",
	"PATCH /api/servicedesk/projects/:key/settings",
	"GET /api/servicedesk/projects/:key/queues",
	"GET /api/servicedesk/projects/:key/queues/:queueId",
	"GET /api/servicedesk/requests",
	"GET /api/servicedesk/issues/:key/sla",
	"GET /api/servicedesk/issues/:key/request",
	"GET /api/site",
	"GET /api/projects/:key/custom-fields",
	"GET /api/projects/:key/versions/:versionId",
	"GET /api/projects/:key/releases",
	"GET /api/resolutions",
	"GET /api/avatars/priorities/:id",
	"GET /api/avatars/issuetypes/:id",
	"POST /api/users/:username/avatar",
	"GET /api/users/:username/profile",
	"GET /api/dashboards",
	"POST /api/dashboards",
	"GET /api/dashboards/default",
	"GET /api/dashboards/:id",
	"PATCH /api/dashboards/:id",
	"DELETE /api/dashboards/:id",
	"PUT /api/dashboards/:id/favourite",
	"DELETE /api/dashboards/:id/favourite",
	"POST /api/dashboards/:id/gadgets",
	"PUT /api/dashboards/:id/layout",
	"PATCH /api/gadgets/:id",
	"DELETE /api/gadgets/:id",
	"GET /api/gadgets/:id/data",
	"GET /api/global-search",
	"POST /auth/local",
	"GET /auth/config",
	"GET /secure/Logout!default.jspa",
	"GET /secure/QuickSearch.jspa",
	"GET /secure/attachment/:sourceId/:fileName",
	"GET /secure/attachmentzip/:issueId.zip",
	"GET /projects/:key",
	"GET /projects/:key/issues",
	"GET /projects/:key/issues/:issueKey",
	"GET /projects/:key/summary",
	"GET /issues",
	"GET /rest/api/2/issue/:key",
	"GET /rest/api/2/search",
	"GET /browse/:key",
]);

const KNOWN_UNPROTECTED = new Set<string>();

/** Signed-in, and the desk is open to every account or the user holds its customer permission. */
const portalRoutes = new Set([
	"GET /api/servicedesk/portals",
	"GET /api/servicedesk/portals/:id",
	"GET /api/servicedesk/portals/:id/request-types/:requestTypeId",
	"POST /api/servicedesk/portals/:id/requests",
]);

const notFoundForNoAccess = new Set([
	"POST /api/issues/:key/clone",
	"POST /api/boards",
	"PATCH /api/boards/:rapidViewId",
	"DELETE /api/boards/:rapidViewId",
	"PUT /api/boards/:rapidViewId/columns",
	"PUT /api/boards/:rapidViewId/swimlanes",
	"PUT /api/boards/:rapidViewId/quick-filters",
	"POST /api/boards/:rapidViewId/sprints",
	"POST /api/boards/:rapidViewId/move",
	"PATCH /api/sprints/:id",
	"DELETE /api/sprints/:id",
	"POST /api/sprints/:id/start",
	"POST /api/sprints/:id/complete",
	"POST /api/sprints/:id/move",
]);

const adminOnlyPrefixes = ["/api/admin/", "/plugins/servlet/"];
const adminOnly = new Set([
	"GET /api/projects/:key/gitlab",
	"PATCH /api/projects/:key/gitlab",
	"GET /sk-admin",
]);
const ownAccessPrefixes = ["/api/wiki/", "/download/"];

function isAdminOnly(key: string) {
	const url = key.slice(key.indexOf(" ") + 1);
	return (
		adminOnly.has(key) ||
		adminOnlyPrefixes.some((prefix) => url.startsWith(prefix)) ||
		isAdminPagePath(url)
	);
}

function hasOwnAccessModel(key: string) {
	const url = key.slice(key.indexOf(" ") + 1);
	return ownAccessPrefixes.some((prefix) => url.startsWith(prefix));
}

/**
 * A Svelte page needs no list entry: its load goes through `pageLoad` or `adminLoad`, and the
 * loop below still requests it as a signed-in user who sees no project.
 */
function isCovered(route: AppRoute) {
	const key = routeKey(route);
	return (
		route.page === true ||
		allowList.has(key) ||
		handled.has(key) ||
		portalRoutes.has(key) ||
		KNOWN_UNPROTECTED.has(key) ||
		isAdminOnly(key) ||
		hasOwnAccessModel(key)
	);
}

function urlFor(pattern: string) {
	const key = pattern.startsWith("/api/projects/")
		? invisibleKey
		: invisible.issueKeys[0];
	let url = pattern.replace(
		/:(\w+)/g,
		(_match, name: string, offset: number) => {
			const prefix = pattern.slice(0, offset);
			if (name === "key") return key;
			if (name === "userId") return otherUserId;
			if (name === "rapidViewId") return String(boardRapidViewId);
			if (name === "versionId") return versionId;
			if (name === "issueKey") return invisible.issueKeys[0] as string;
			if (name === "username") return `t-${run}-other`;
			if (name === "sourceId" || name === "pageId") return "unknown";
			if (name === "fileName") return "secret.txt";
			if (name !== "id") return randomUUID();
			if (prefix === "/api/components/") return componentId;
			if (prefix === "/api/versions/") return versionId;
			if (prefix === "/api/attachments/") return attachmentId;
			if (prefix === "/api/issue-links/") return linkId;
			if (prefix === "/api/sprints/") return sprintId;
			if (prefix.startsWith("/api/filters/")) return filterId;
			if (prefix.startsWith("/api/notifications/")) return notificationId;
			if (prefix === "/api/avatars/projects/") return invisible.projectId;
			if (prefix === "/api/avatars/users/") return otherUserId;
			return randomUUID();
		},
	);
	const query: Record<string, string> = {};
	if (pattern === "/api/search" || pattern === "/api/search/issues") {
		query.jql = `project = ${invisibleKey}`;
	}
	if (pattern === "/api/search/export") {
		query.jql = `project = ${invisibleKey}`;
	}
	if (pattern === "/api/quicksearch") query.q = invisibleKey;
	if (pattern === "/api/jql/suggest") {
		query.field = "project";
		query.prefix = invisibleKey.slice(0, 3);
	}
	if (pattern === "/api/projects/:key/issues") {
		query.offset = "0";
		query.limit = "50";
	}
	if (pattern === "/api/issues/recent") query.limit = "50";
	if (pattern === "/api/notifications") query.tab = "all";
	if (pattern === "/api/filters") query.scope = "visible";
	if (pattern === "/api/search/issues") {
		query.startAt = "0";
		query.maxResults = "50";
	}
	if (Object.keys(query).length > 0) {
		url += `?${new URLSearchParams(query).toString()}`;
	}
	return url;
}

function bodyFor(method: string, pattern: string) {
	if (
		method === "POST" &&
		pattern === "/api/projects/:key/roles/:roleId/actors"
	) {
		return { actorType: "user", actorId: otherUserId };
	}
	if (method === "POST" && pattern === "/api/issues") {
		return {
			project: invisibleKey,
			type: randomUUID(),
			summary: secretSummary,
		};
	}
	if (method === "POST" && pattern === "/api/search") {
		return { jql: `project = ${invisibleKey}` };
	}
	if (method === "POST" && pattern === "/api/projects/:key/components") {
		return { name: secretComponent };
	}
	if (method === "POST" && pattern === "/api/projects/:key/versions") {
		return { name: secretVersion };
	}
	if (
		method === "PATCH" &&
		(pattern === "/api/issues/:key" || pattern === "/api/projects/:key")
	) {
		return { summary: secretSummary, name: secretSummary };
	}
	if (method === "PATCH" && pattern === "/api/issues/:key/comments/:id") {
		return { body: "secret comment" };
	}
	if (method === "POST" && pattern === "/api/issues/:key/comments") {
		return { body: "secret comment" };
	}
	if (method === "POST" && pattern === "/api/issues/:key/worklogs") {
		return { seconds: 60 };
	}
	if (method === "POST" && pattern === "/api/issues/:key/watchers") {
		return { userId: otherUserId };
	}
	if (method === "POST" && pattern === "/api/issues/:key/links") {
		return {
			typeId: linkId,
			targetKey: visible.issueKeys[0],
			direction: "outward",
		};
	}
	if (method === "POST" && pattern === "/api/issues/:key/transitions") {
		return { transitionId: randomUUID() };
	}
	if (method === "POST" && pattern === "/api/filters") {
		return { name: "Enforcement filter", jql: `project = ${visibleKey}` };
	}
	if (method === "PATCH" && pattern === "/api/filters/:id") {
		return { name: "Enforcement filter" };
	}
	if (method === "PUT" && pattern === "/api/navigator/preferences") {
		return { view: "list" };
	}
	if (method === "PUT" && pattern === "/api/me/notification-settings") {
		return { emailNotifications: false };
	}
	if (pattern === "/api/boards" && method === "POST") {
		return {
			name: secretBoard,
			type: "scrum",
			filterJql: `project = ${visibleKey}`,
			project: invisibleKey,
		};
	}
	if (pattern === "/api/boards/:rapidViewId" && method === "PATCH") {
		return { name: secretBoard, project: invisibleKey };
	}
	if (pattern === "/api/boards/:rapidViewId/columns") {
		return { columns: [{ name: "Secret", statuses: [] }] };
	}
	if (pattern === "/api/boards/:rapidViewId/swimlanes") {
		return { swimlanes: [{ name: "Secret", jql: "project is not EMPTY" }] };
	}
	if (pattern === "/api/boards/:rapidViewId/quick-filters") {
		return { quickFilters: [{ name: "Secret", jql: "project is not EMPTY" }] };
	}
	if (pattern === "/api/boards/:rapidViewId/sprints") {
		return { name: secretSprint };
	}
	if (pattern === "/api/boards/:rapidViewId/move") {
		return { issues: [invisible.issueKeys[0]], sprintId: sprintId };
	}
	if (pattern === "/api/sprints/:id" && method === "PATCH") {
		return { name: secretSprint };
	}
	if (pattern === "/api/sprints/:id/start") {
		return {
			startDate: new Date().toISOString(),
			endDate: new Date(Date.now() + 86_400_000).toISOString(),
		};
	}
	if (pattern === "/api/sprints/:id/complete") return {};
	if (pattern === "/api/sprints/:id/move") return { direction: "up" };
	if (method === "POST" && pattern === "/api/me/tokens") {
		return { name: "enforcement token" };
	}
	return undefined;
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const loggedIn = await login(app, {
		sub: `${run}-enforcement`,
		username: `t-${run}-enforce`,
		name: "Enforcement User",
		groups: [],
	});
	session = loggedIn.sessionId as string;
	const rows = await pool.query<{ id: string; username: string }>(
		"select id, username from users where username like $1 order by username",
		[`t-${run}-%`],
	);
	userId = rows.rows.find((row) => row.username === `t-${run}-enforce`)
		?.id as string;
	const [other] = await db
		.insert(users)
		.values({
			username: `t-${run}-other`,
			displayName: "Other User",
		})
		.returning();
	otherUserId = other.id;

	visible = await createProjectFixture(client, {
		run: `${run}vis`,
		key: visibleKey,
		name: `Visible ${run}`,
		issues: [{ summary: `Visible issue ${run}` }],
	});
	invisible = await createProjectFixture(client, {
		run: `${run}inv`,
		key: invisibleKey,
		name: `Invisible ${run}`,
		issues: [{ summary: secretSummary }],
	});
	visibleIssueId = visible.issueIds[0];
	invisibleIssueId = invisible.issueIds[0];

	await db.insert(permissionSchemes).values({
		sourceId: `${run}:invisible-scheme`,
		name: `Invisible scheme ${run}`,
		projectIds: [invisible.projectId],
		raw: {},
	});

	const [component] = await db
		.insert(components)
		.values({
			sourceId: `${run}:invisible-component`,
			projectId: invisible.projectId,
			name: secretComponent,
		})
		.returning();
	componentId = component.id;
	const [version] = await db
		.insert(versions)
		.values({
			sourceId: `${run}:invisible-version`,
			projectId: invisible.projectId,
			name: secretVersion,
		})
		.returning();
	versionId = version.id;

	const [linkType] = await db
		.insert(linkTypes)
		.values({
			sourceId: `${run}:link-type`,
			name: secretLinkType,
			inward: "is blocked by",
			outward: "blocks",
		})
		.returning();
	const [link] = await db
		.insert(issueLinks)
		.values({
			sourceId: `${run}:link`,
			typeId: linkType.id,
			sourceIssueId: visibleIssueId,
			targetIssueId: invisibleIssueId,
		})
		.returning();
	linkId = link.id;

	const [attachment] = await db
		.insert(attachments)
		.values({
			sourceId: `${run}:attachment`,
			issueId: invisibleIssueId,
			fileName: secretAttachment,
			mimeType: "text/plain",
			size: 5,
			storagePath: "secret/missing",
			sha256: "0".repeat(64),
		})
		.returning();
	attachmentId = attachment.id;

	await db.insert(comments).values({
		sourceId: `${run}:comment`,
		issueId: invisibleIssueId,
		bodyHtml: "<p>Secret comment</p>",
		created: new Date(),
		updated: new Date(),
	});
	await db.insert(worklogs).values({
		sourceId: `${run}:worklog`,
		issueId: invisibleIssueId,
		started: new Date(),
		seconds: 60,
		comment: "Secret worklog",
	});
	await db.insert(issueViews).values({
		userId,
		issueId: invisibleIssueId,
		viewedAt: new Date(),
	});

	const [filter] = await db
		.insert(filters)
		.values({
			name: secretFilter,
			jql: `project = ${invisibleKey}`,
			ownerId: otherUserId,
			shared: false,
		})
		.returning();
	filterId = filter.id;
	await db.insert(filterShares).values({
		filterId,
		projectId: invisible.projectId,
	});

	const [board] = await db
		.insert(boards)
		.values({
			rapidViewId: 700000 + Number.parseInt(run.slice(0, 5), 16),
			sourceId: `${run}:board`,
			name: secretBoard,
			type: "scrum",
			filterJql: `project = ${invisibleKey}`,
			projectId: invisible.projectId,
		})
		.returning();
	boardRapidViewId = board.rapidViewId;
	const [sprint] = await db
		.insert(sprints)
		.values({
			sourceId: `${run}:sprint`,
			boardId: board.id,
			name: secretSprint,
			state: "future",
		})
		.returning();
	sprintId = sprint.id;

	const [notification] = await db
		.insert(notifications)
		.values({
			userId,
			issueId: invisibleIssueId,
			issueKey: invisible.issueKeys[0],
			issueSummary: secretSummary,
			kind: "created",
			direct: true,
		})
		.returning();
	notificationId = notification.id;
});

afterAll(async () => {
	if (client) {
		await client.query("delete from filters where name = $1", [secretFilter]);
		await client.query("delete from boards where source_id = $1", [
			`${run}:board`,
		]);
		await dropProjectFixture(client, `${run}vis`);
		await dropProjectFixture(client, `${run}inv`);
		await client.end();
	}
	await pool.query("delete from permission_schemes where source_id = $1", [
		`${run}:invisible-scheme`,
	]);
	await pool.query("delete from link_types where source_id = $1", [
		`${run}:link-type`,
	]);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("every registered route hides an invisible project's data", async () => {
	const routes = (await allAppRoutes()).filter(
		(route) => route.method !== "HEAD",
	);
	const registered = new Set(routes.map(routeKey));
	for (const route of routes) {
		if (!isCovered(route)) {
			throw new Error(
				`Route ${routeKey(route)} is not covered by the permission test`,
			);
		}
	}
	expect(routes.length).toBeGreaterThan(30);
	for (const route of KNOWN_UNPROTECTED)
		expect(registered.has(route)).toBe(true);
	for (const route of portalRoutes) expect(registered.has(route)).toBe(true);

	const secrets = [
		invisibleKey,
		`Invisible ${run}`,
		invisible.issueKeys[0] as string,
		secretSummary,
		secretComponent,
		secretVersion,
		secretAttachment,
		secretFilter,
		secretLinkType,
		secretBoard,
		secretSprint,
	];

	for (const route of routes) {
		const key = routeKey(route);
		if (allowList.has(key) || KNOWN_UNPROTECTED.has(key)) {
			continue;
		}
		const url = urlFor(route.pattern);
		const response = await app.inject({
			method: route.method as "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
			url,
			cookies: { sid: session },
			headers: { "x-requested-with": "rvna" },
			payload: bodyFor(route.method, route.pattern) as never,
		});
		const requested = url.split("?")[0];
		// A page may echo the address the visitor typed, in its title or its not-found text.
		const echoes =
			route.kind === "page"
				? requested.split("/").filter((segment) => segment.length > 2)
				: [requested];
		const text = echoes.reduce(
			(body, echo) => body.split(echo).join(""),
			String(response.body),
		);
		for (const secret of secrets) {
			expect(
				text.includes(secret),
				`${key} leaked ${secret}: ${text.slice(0, 200)}`,
			).toBe(false);
		}
		if (notFoundForNoAccess.has(key)) {
			expect(response.statusCode, `${key} should be 404`).toBe(404);
		}
		if (isAdminOnly(key)) {
			expect(response.statusCode, `${key} should be 403`).toBe(403);
		}
		if (
			route.method === "GET" &&
			(route.pattern === "/api/issues/:key" ||
				route.pattern === "/api/projects/:key" ||
				route.pattern === "/api/projects/:key/roles" ||
				route.pattern === "/api/projects/:key/issues" ||
				route.pattern === "/api/attachments/:id" ||
				route.pattern === "/api/avatars/projects/:id" ||
				route.pattern === "/api/issues/:key/comments" ||
				route.pattern === "/api/issues/:key/history" ||
				route.pattern === "/api/issues/:key/worklogs" ||
				route.pattern === "/api/issues/:key/watchers" ||
				route.pattern === "/api/issues/:key/development" ||
				route.pattern === "/api/boards/:rapidViewId" ||
				route.pattern === "/api/boards/:rapidViewId/data" ||
				route.pattern === "/api/boards/:rapidViewId/backlog" ||
				route.pattern.startsWith("/api/boards/:rapidViewId/reports/") ||
				route.pattern === "/api/projects/:key/custom-fields" ||
				route.pattern === "/api/projects/:key/releases" ||
				route.pattern === "/api/projects/:key/versions/:versionId")
		) {
			expect(response.statusCode, `${key} should be 404`).toBe(404);
		}
	}

	const search = await app.inject({
		method: "GET",
		url: `/api/search?jql=${encodeURIComponent(`project = ${invisibleKey}`)}`,
		cookies: { sid: session },
	});
	expect(search.statusCode).toBe(200);
	expect(search.json().total).toBe(0);
	expect(search.json().issues).toEqual([]);

	const token = (
		await app.inject({
			method: "POST",
			url: "/api/me/tokens",
			cookies: { sid: session },
			headers: { "x-requested-with": "rvna" },
			payload: { name: "enforcement token" },
		})
	).json().token as string;
	const bearer = { authorization: `Bearer ${token}` };
	const compatIssue = await app.inject({
		method: "GET",
		url: `/rest/api/2/issue/${invisible.issueKeys[0]}`,
		headers: bearer,
	});
	expect(compatIssue.statusCode).toBe(404);
	expect(compatIssue.body).not.toContain(secretSummary);
	const compatSearch = await app.inject({
		method: "GET",
		url: `/rest/api/2/search?jql=${encodeURIComponent(`project = ${invisibleKey}`)}`,
		headers: bearer,
	});
	expect(compatSearch.statusCode).toBe(200);
	expect(compatSearch.json().total).toBe(0);

	const visibleIssue = await app.inject({
		method: "GET",
		url: `/api/issues/${visible.issueKeys[0]}`,
		cookies: { sid: session },
	});
	expect(visibleIssue.statusCode).toBe(200);
	expect(visibleIssue.json().links).toEqual([]);
}, 120_000);
