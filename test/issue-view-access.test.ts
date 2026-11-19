import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { isHttpError } from "../src/lib/server/http.ts";
import { loadIssueView } from "../src/lib/server/issues/view.ts";
import { loadProjectSidebar } from "../src/lib/server/projects/sidebar.ts";
import { load as loadBrowse } from "../src/routes/browse/[key]/+page.server.ts";
import { injectAs, makeUser, newRun } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	type SeedResult,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const projectKey = `IV${run.slice(0, 5).toUpperCase()}`;
const projectRun = `${run}iv`;
const schemeSource = `test:${run}:issue-view-scheme`;

let app: TestApp;
let client: Client;
let actor: CurrentUser;
let user: Awaited<ReturnType<typeof makeUser>>;
let fixture: SeedResult;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	user = await makeUser(run, "issue-view");
	actor = {
		id: user.id,
		username: user.username,
		displayName: `Test issue view ${run}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};

	fixture = await createProjectFixture(client, {
		run: projectRun,
		key: projectKey,
		name: `Issue view project ${run}`,
		issues: [
			{ summary: `Reporter issue ${run}`, reporterId: user.id },
			{ summary: `Preloaded issue ${run}`, reporterId: user.id },
		],
	});

	// The reporter may browse this issue, but not the project as a whole.
	const scheme = await client.query<{ id: string }>(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb) returning id`,
		[
			schemeSource,
			`Issue view scheme ${run}`,
			JSON.stringify([fixture.projectId]),
		],
	);
	await client.query(
		`insert into permission_grants
		 (source_id, scheme_id, permission_key, holder_type, holder_parameter, raw)
		 values ($1, $2, 'BROWSE_PROJECTS', 'reporter', null, '{}'::jsonb)`,
		[`${schemeSource}:grant`, scheme.rows[0].id],
	);
});

afterAll(async () => {
	if (client) {
		await client.query("delete from permission_schemes where source_id = $1", [
			schemeSource,
		]);
		await dropProjectFixture(client, projectRun);
		await cleanupTestData(run);
		await client.end();
	}
	await app.close();
	await pool.end();
});

test("an issue-only reporter gets the issue view and page without project browse", async () => {
	const view = await loadIssueView(actor, fixture.issueKeys[0] as string);

	expect(view.issue.key).toBe(fixture.issueKeys[0]);
	expect(view.issue.summary).toBe(`Reporter issue ${run}`);
	expect(view.project.archived).toBe(false);
	expect(view.panels.request.requestType).toBeNull();

	await expect(loadProjectSidebar(actor, fixture.projectKey)).rejects.toSatisfy(
		(cause: unknown) => isHttpError(cause) && cause.status === 404,
	);

	const page = await loadBrowse({
		locals: { user: actor },
		params: { key: fixture.issueKeys[0] },
		route: { id: "/browse/[key]" },
		url: new URL(`http://localhost/browse/${fixture.issueKeys[0]}`),
		depends: () => undefined,
	} as never);
	expect(page.view.issue.summary).toBe(`Reporter issue ${run}`);
	expect(page.sidebar).toBeNull();
});

test("a preload-style issue load does not record a view", async () => {
	const issueId = fixture.issueIds[1] as string;
	const before = await client.query<{ total: number }>(
		"select count(*)::int as total from issue_views where issue_id = $1",
		[issueId],
	);

	await loadIssueView(actor, fixture.issueKeys[1] as string);

	const after = await client.query<{ total: number }>(
		"select count(*)::int as total from issue_views where issue_id = $1",
		[issueId],
	);
	expect(after.rows[0]?.total).toBe(before.rows[0]?.total);
});

test("the explicit view endpoint records the view after the page is shown", async () => {
	const issueId = fixture.issueIds[1] as string;
	const response = await injectAs(
		app,
		user.session,
		"POST",
		`/api/issues/${fixture.issueKeys[1]}/view`,
	);
	expect(response.statusCode).toBe(204);

	const stored = await client.query(
		"select issue_id from issue_views where issue_id = $1",
		[issueId],
	);
	expect(stored.rowCount).toBe(1);
});
