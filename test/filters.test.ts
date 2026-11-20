import { afterAll, beforeAll, expect, test } from "vitest";
import { userForSession } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import {
	createFilter as createFilterService,
	deleteFilter,
	getFilter,
	listFiltersForPage,
	setFavourite,
	updateFilter,
} from "../src/lib/server/filters/service.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = `filters-${Math.random().toString(36).slice(2, 8)}`;
let app: TestApp;
let ownerSession: string;
let otherSession: string;
let adminSession: string;
let outsiderSession: string;
let groupId: string;
let otherId: string;
let visibleProjectId: string;
let hiddenProjectId: string;
let hiddenSchemeId: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	const owner = await login(app, {
		sub: `sub-${run}-owner`,
		username: `t-${run}-owner`,
		name: "Filter Owner",
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
	const outsider = await login(app, {
		sub: `sub-${run}-outsider`,
		username: `t-${run}-outsider`,
		name: "Outsider User",
		groups: [],
	});
	ownerSession = owner.sessionId as string;
	otherSession = other.sessionId as string;
	adminSession = admin.sessionId as string;
	outsiderSession = outsider.sessionId as string;

	const [group] = await pool
		.query<{ id: string }>(
			"insert into groups (name, local) values ($1, false) returning id",
			[`t-${run}-viewers`],
		)
		.then((result) => [result.rows[0]]);
	groupId = group.id;
	const otherRows = await pool.query<{ id: string }>(
		"select id from users where username = $1",
		[`t-${run}-other`],
	);
	otherId = otherRows.rows[0].id;
	await pool.query(
		"insert into user_groups (user_id, group_id, source) values ($1, $2, 'oidc')",
		[otherId, groupId],
	);

	const visible = await pool.query<{ id: string }>(
		"insert into projects (source_id, key, name, project_type, last_issue_number) values ($1, $2, $3, 'software', 0) returning id",
		[
			`test:${run}:visible-project`,
			`V${run.slice(0, 6).toUpperCase()}`,
			`Visible ${run}`,
		],
	);
	visibleProjectId = visible.rows[0].id;
	const hidden = await pool.query<{ id: string }>(
		"insert into projects (source_id, key, name, project_type, last_issue_number) values ($1, $2, $3, 'software', 0) returning id",
		[
			`test:${run}:hidden-project`,
			`H${run.slice(0, 6).toUpperCase()}`,
			`Hidden ${run}`,
		],
	);
	hiddenProjectId = hidden.rows[0].id;
	const scheme = await pool.query<{ id: string }>(
		"insert into permission_schemes (source_id, name, project_ids, raw) values ($1, $2, $3::jsonb, '{}'::jsonb) returning id",
		[
			`test:${run}:hidden-scheme`,
			`Hidden scheme ${run}`,
			JSON.stringify([hiddenProjectId]),
		],
	);
	hiddenSchemeId = scheme.rows[0].id;
});

afterAll(async () => {
	await pool.query("delete from permission_schemes where id = $1", [
		hiddenSchemeId,
	]);
	await pool.query("delete from projects where id = any($1::uuid[])", [
		[visibleProjectId, hiddenProjectId],
	]);
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

async function createFilter(
	name: string,
	shared = false,
	session = ownerSession,
) {
	const response = await request("POST", "/api/filters", session, {
		name,
		jql: "project = DEMO ORDER BY key ASC",
		columns: ["key", "summary"],
		shared,
	});
	expect(response.statusCode).toBe(201);
	return response.json();
}

test("a filter is created with its owner, columns and permissions", async () => {
	const filter = await createFilter(`Owner filter ${run}`);
	expect(filter).toMatchObject({
		name: `Owner filter ${run}`,
		jql: "project = DEMO ORDER BY key ASC",
		columns: ["key", "summary"],
		shared: false,
		favourite: false,
		favouriteCount: 0,
		canEdit: true,
	});
	expect(filter.owner.username).toBe(`t-${run}-owner`);
	expect(filter.owner.avatarUrl).toMatch(/^\/api\/avatars\/users\//);
});

test("a private filter is invisible to others, a shared one is visible", async () => {
	const privateFilter = await createFilter(`Private ${run}`);
	const sharedFilter = await createFilter(`Shared ${run}`, true);

	const otherMine = await request(
		"GET",
		"/api/filters?scope=visible",
		otherSession,
	);
	expect(otherMine.statusCode).toBe(200);
	const visible = otherMine.json();
	expect(
		visible.some((item: { id: string }) => item.id === privateFilter.id),
	).toBe(false);
	expect(
		visible.some((item: { id: string }) => item.id === sharedFilter.id),
	).toBe(true);

	const hidden = await request(
		"GET",
		`/api/filters/${privateFilter.id}`,
		otherSession,
	);
	expect(hidden.statusCode).toBe(404);

	const shown = await request(
		"GET",
		`/api/filters/${sharedFilter.id}`,
		otherSession,
	);
	expect(shown.statusCode).toBe(200);
	expect(shown.json().canEdit).toBe(false);
});

test("only the owner or an administrator can change a filter", async () => {
	const filter = await createFilter(`Editable ${run}`, true);

	const denied = await request(
		"PATCH",
		`/api/filters/${filter.id}`,
		otherSession,
		{
			name: "Hijacked",
		},
	);
	expect(denied.statusCode).toBe(403);

	const byAdmin = await request(
		"PATCH",
		`/api/filters/${filter.id}`,
		adminSession,
		{
			name: `Renamed by admin ${run}`,
		},
	);
	expect(byAdmin.statusCode).toBe(200);
	expect(byAdmin.json().name).toBe(`Renamed by admin ${run}`);

	const byOwner = await request(
		"PATCH",
		`/api/filters/${filter.id}`,
		ownerSession,
		{
			columns: ["key", "status", "assignee"],
		},
	);
	expect(byOwner.statusCode).toBe(200);
	expect(byOwner.json().columns).toEqual(["key", "status", "assignee"]);

	const deniedDelete = await request(
		"DELETE",
		`/api/filters/${filter.id}`,
		otherSession,
	);
	expect(deniedDelete.statusCode).toBe(403);

	const deleted = await request(
		"DELETE",
		`/api/filters/${filter.id}`,
		ownerSession,
	);
	expect(deleted.statusCode).toBe(204);

	const missing = await request(
		"GET",
		`/api/filters/${filter.id}`,
		ownerSession,
	);
	expect(missing.statusCode).toBe(404);
});

test("favourites are per user and popular orders by favourite count", async () => {
	const filter = await createFilter(`Popular ${run}`, true);

	const first = await request(
		"PUT",
		`/api/filters/${filter.id}/favourite`,
		ownerSession,
	);
	expect(first.statusCode).toBe(200);
	expect(first.json()).toEqual({ favourite: true, favouriteCount: 1 });

	const second = await request(
		"PUT",
		`/api/filters/${filter.id}/favourite`,
		otherSession,
	);
	expect(second.json()).toEqual({ favourite: true, favouriteCount: 2 });

	const mine = await request(
		"GET",
		"/api/filters?scope=favourite",
		otherSession,
	);
	expect(
		mine.json().some((item: { id: string }) => item.id === filter.id),
	).toBe(true);

	const popular = await request(
		"GET",
		"/api/filters?scope=popular",
		ownerSession,
	);
	const listed = popular.json() as { id: string; favouriteCount: number }[];
	expect(listed[0]?.id).toBe(filter.id);
	expect(listed[0]?.favouriteCount).toBe(2);

	const removed = await request(
		"DELETE",
		`/api/filters/${filter.id}/favourite`,
		otherSession,
	);
	expect(removed.json()).toEqual({ favourite: false, favouriteCount: 1 });

	const after = await request(
		"GET",
		"/api/filters?scope=favourite",
		otherSession,
	);
	expect(
		after.json().some((item: { id: string }) => item.id === filter.id),
	).toBe(false);
});

test("the search scope matches names, case insensitively", async () => {
	const filter = await createFilter(`Zephyr report ${run}`, true);

	const found = await request(
		"GET",
		"/api/filters?scope=search&query=zephyr",
		otherSession,
	);
	expect(found.statusCode).toBe(200);
	expect(
		found.json().some((item: { id: string }) => item.id === filter.id),
	).toBe(true);

	const missing = await request(
		"GET",
		"/api/filters?scope=search&query=nothing-matches-this",
		otherSession,
	);
	expect(missing.json()).toHaveLength(0);
});

test("a filter shared with a group is visible only to qualifying users", async () => {
	const created = await request("POST", "/api/filters", otherSession, {
		name: `Group shared ${run}`,
		jql: "project = DEMO",
		sharedGroupIds: [groupId],
	});
	expect(created.statusCode).toBe(201);
	const filter = created.json();
	expect(filter.sharedWith.groups).toEqual([`t-${run}-viewers`]);

	const member = await request(
		"GET",
		`/api/filters/${filter.id}`,
		otherSession,
	);
	expect(member.statusCode).toBe(200);

	const outsider = await request(
		"GET",
		`/api/filters/${filter.id}`,
		outsiderSession,
	);
	expect(outsider.statusCode).toBe(404);

	const list = await request(
		"GET",
		"/api/filters?scope=visible",
		outsiderSession,
	);
	expect(
		list.json().some((item: { id: string }) => item.id === filter.id),
	).toBe(false);

	const admin = await request("GET", `/api/filters/${filter.id}`, adminSession);
	expect(admin.statusCode).toBe(200);
});

test("the groups a filter can be shared with are the viewer's own, all of them for an administrator", async () => {
	const names = async (session: string) => {
		const response = await request("GET", "/api/filters/share-groups", session);
		expect(response.statusCode).toBe(200);
		return (response.json() as { id: string; name: string }[]).filter(
			(group) => group.id === groupId,
		);
	};
	expect(await names(otherSession)).toEqual([
		{ id: groupId, name: `t-${run}-viewers` },
	]);
	expect(await names(outsiderSession)).toEqual([]);
	expect(await names(adminSession)).toHaveLength(1);
	const anonymous = await app.inject({
		method: "GET",
		url: "/api/filters/share-groups",
	});
	expect(anonymous.statusCode).toBe(401);
});

test("filter endpoints require a session", async () => {
	const response = await app.inject({ method: "GET", url: "/api/filters" });
	expect(response.statusCode).toBe(401);
});

test("sharing on create is limited to projects the editor can browse and groups they belong to", async () => {
	const hiddenProject = await request("POST", "/api/filters", ownerSession, {
		name: `Hidden project share ${run}`,
		jql: "project = DEMO",
		sharedProjectIds: [hiddenProjectId],
	});
	expect(hiddenProject.statusCode).toBe(400);
	expect(hiddenProject.json().error).toMatch(/projects you can browse/i);

	const foreignGroup = await request("POST", "/api/filters", ownerSession, {
		name: `Foreign group share ${run}`,
		jql: "project = DEMO",
		sharedGroupIds: [groupId],
	});
	expect(foreignGroup.statusCode).toBe(400);
	expect(foreignGroup.json().error).toMatch(/groups you are a member of/i);

	const visible = await request("POST", "/api/filters", ownerSession, {
		name: `Visible project share ${run}`,
		jql: "project = DEMO",
		sharedProjectIds: [visibleProjectId],
	});
	expect(visible.statusCode).toBe(201);
	expect(visible.json().sharedWith.projectIds).toEqual([visibleProjectId]);

	const ownGroup = await request("POST", "/api/filters", otherSession, {
		name: `Own group share ${run}`,
		jql: "project = DEMO",
		sharedGroupIds: [groupId],
	});
	expect(ownGroup.statusCode).toBe(201);
	expect(ownGroup.json().sharedWith.groups).toEqual([`t-${run}-viewers`]);
});

test("an administrator may share a filter with anything", async () => {
	const response = await request("POST", "/api/filters", adminSession, {
		name: `Admin share ${run}`,
		jql: "project = DEMO",
		sharedProjectIds: [hiddenProjectId],
		sharedGroupIds: [groupId],
	});
	expect(response.statusCode).toBe(201);
	expect(response.json().sharedWith.projectIds).toEqual([hiddenProjectId]);
	expect(response.json().sharedWith.groups).toEqual([`t-${run}-viewers`]);
});

test("a viewer does not receive the share list", async () => {
	const created = await request("POST", "/api/filters", adminSession, {
		name: `Viewer share ${run}`,
		jql: "project = DEMO",
		shared: true,
		sharedProjectIds: [hiddenProjectId],
		sharedGroupIds: [groupId],
	});
	expect(created.statusCode).toBe(201);
	const id = created.json().id as string;

	const list = await request("GET", "/api/filters?scope=visible", otherSession);
	const row = (list.json() as { id: string }[]).find(
		(filter) => filter.id === id,
	);
	expect(row).toBeDefined();
	expect(row).toMatchObject({ shared: true });
	expect((row as { sharedWith?: unknown }).sharedWith).toBeUndefined();

	const single = await request("GET", `/api/filters/${id}`, otherSession);
	expect(single.statusCode).toBe(200);
	expect(single.json().sharedWith).toBeUndefined();

	const editor = await request("GET", `/api/filters/${id}`, adminSession);
	expect(editor.json().sharedWith.projectIds).toEqual([hiddenProjectId]);
});

test("an existing share survives an edit even when the owner could not add it now", async () => {
	const created = await createFilter(`Existing shares ${run}`);
	await pool.query(
		"insert into filter_shares (filter_id, project_id) values ($1, $2)",
		[created.id, hiddenProjectId],
	);
	await pool.query(
		"insert into filter_shares (filter_id, group_id) values ($1, $2)",
		[created.id, groupId],
	);

	const kept = await request(
		"PATCH",
		`/api/filters/${created.id}`,
		ownerSession,
		{
			name: `Existing shares renamed ${run}`,
			sharedProjectIds: [hiddenProjectId],
			sharedGroupIds: [groupId],
		},
	);
	expect(kept.statusCode).toBe(200);
	expect(kept.json().sharedWith.projectIds).toEqual([hiddenProjectId]);
	expect(kept.json().sharedWith.groups).toEqual([`t-${run}-viewers`]);

	const partial = await request(
		"PATCH",
		`/api/filters/${created.id}`,
		ownerSession,
		{ sharedProjectIds: [hiddenProjectId] },
	);
	expect(partial.statusCode).toBe(200);
	expect(partial.json().sharedWith.groups).toEqual([`t-${run}-viewers`]);

	const added = await request(
		"PATCH",
		`/api/filters/${created.id}`,
		ownerSession,
		{
			sharedProjectIds: [
				hiddenProjectId,
				"00000000-0000-4000-8000-000000000000",
			],
		},
	);
	expect(added.statusCode).toBe(400);
	expect(added.json().error).toMatch(/projects you can browse/i);

	const addedGroup = await request(
		"PATCH",
		`/api/filters/${created.id}`,
		ownerSession,
		{ sharedGroupIds: [groupId, "00000000-0000-4000-8000-000000000001"] },
	);
	expect(addedGroup.statusCode).toBe(400);
	expect(addedGroup.json().error).toMatch(/groups you are a member of/i);
});

test("an edit that omits a share the editor cannot see keeps it", async () => {
	const actor = await userForSession(ownerSession);
	if (!actor) throw new Error("The test session has no user");
	const created = await createFilterService(actor, {
		name: `Unseen shares ${run}`,
		jql: "project = DEMO",
	});
	await pool.query(
		"insert into filter_shares (filter_id, project_id) values ($1, $2)",
		[created.id, hiddenProjectId],
	);
	await pool.query(
		"insert into filter_shares (filter_id, group_id) values ($1, $2)",
		[created.id, groupId],
	);

	const updated = await updateFilter(actor, created.id, {
		name: `Unseen shares renamed ${run}`,
		sharedProjectIds: [],
		sharedGroupIds: [],
	});
	expect(updated.sharedWith).toMatchObject({
		projectIds: [hiddenProjectId],
		groups: [`t-${run}-viewers`],
	});
});

test("an edit replaces a share the editor can see", async () => {
	const actor = await userForSession(ownerSession);
	if (!actor) throw new Error("The test session has no user");
	const created = await createFilterService(actor, {
		name: `Visible share ${run}`,
		jql: "project = DEMO",
		sharedProjectIds: [visibleProjectId],
	});

	const updated = await updateFilter(actor, created.id, {
		sharedProjectIds: [],
	});
	expect(updated.sharedWith?.projectIds).toEqual([]);
});

test("a filter page only gives share IDs to an editor", async () => {
	const owner = await userForSession(ownerSession);
	const other = await userForSession(otherSession);
	if (!owner || !other) throw new Error("The test sessions have no user");
	const created = await createFilterService(owner, {
		name: `Page shares ${run}`,
		jql: "project = DEMO",
		sharedProjectIds: [visibleProjectId],
	});

	const viewerList = await listFiltersForPage(other, {
		scope: "visible",
		query: "",
	});
	const viewer = viewerList.find((filter) => filter.id === created.id);
	expect(viewer?.sharedWith).toBeUndefined();
	expect(viewer?.sharedSome).toBe(true);

	const ownerList = await listFiltersForPage(owner, {
		scope: "visible",
		query: "",
	});
	const editor = ownerList.find((filter) => filter.id === created.id);
	expect(editor?.sharedWith?.projectIds).toEqual([visibleProjectId]);
	expect(editor?.sharedWith?.groupIds).toEqual([]);
});

test("filter service functions reject a non-UUID id without a database error", async () => {
	const actor = await userForSession(ownerSession);
	if (!actor) throw new Error("The test session has no user");
	const id = "not-a-uuid";
	await expect(getFilter(actor, id)).rejects.toMatchObject({ status: 404 });
	await expect(updateFilter(actor, id, {})).rejects.toMatchObject({
		status: 404,
	});
	await expect(deleteFilter(actor, id)).rejects.toMatchObject({ status: 404 });
	await expect(setFavourite(actor, id, true)).rejects.toMatchObject({
		status: 404,
	});
});

test("createFilter validates body bounds inside the function", async () => {
	const actor = await userForSession(ownerSession);
	if (!actor) throw new Error("The test session has no user");
	await expect(
		createFilterService(actor, {
			name: "x".repeat(256),
			jql: "project = DEMO",
		}),
	).rejects.toMatchObject({ status: 400 });
});
