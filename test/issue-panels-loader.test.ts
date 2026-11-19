import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { isHttpError } from "../src/lib/server/http.ts";
import { loadIssuePanels } from "../src/lib/server/issues/view-panels.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
} from "./fixtures/project.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const softwareKey = `P${run.slice(0, 5).toUpperCase()}`;
const deskKey = `D${run.slice(0, 5).toUpperCase()}`;
const hiddenKey = `H${run.slice(0, 5).toUpperCase()}`;
const softwareRun = `${run}sw`;
const deskRun = `${run}sd`;
const hiddenRun = `${run}hi`;
const hiddenScheme = `test:${run}:panels-hidden-scheme`;
const calendarSource = `test:${run}:panels-calendar`;

let client: Client;
let actor: CurrentUser;
let viewer: CurrentUser;
let softwareProjectId: string;
let deskProjectId: string;
let hiddenProjectId: string;
let softwareIssueKey: string;
let deskIssueKey: string;
let hiddenIssueKey: string;
let repositoryId: string;

function currentUser(
	id: string,
	username: string,
	isAdmin = false,
): CurrentUser {
	return {
		id,
		username,
		displayName: `Test panels ${run}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin,
		mustChangePassword: false,
		hasPassword: false,
	};
}

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const member = await makeUser(run, "panels");
	actor = currentUser(member.id, member.username);
	const other = await makeUser(run, "viewer");
	viewer = currentUser(other.id, other.username);

	const software = await createProjectFixture(client, {
		run: softwareRun,
		key: softwareKey,
		name: `Panels software ${run}`,
		issues: [{ summary: "Panels software issue" }],
	});
	softwareProjectId = software.projectId;
	softwareIssueKey = software.issueKeys[0];

	const desk = await createProjectFixture(client, {
		run: deskRun,
		key: deskKey,
		name: `Panels desk ${run}`,
		issues: [{ summary: "Panels desk issue" }],
		admins: [actor.username],
	});
	deskProjectId = desk.projectId;
	deskIssueKey = desk.issueKeys[0];
	await client.query(
		"update projects set project_type = 'service_desk' where id = $1",
		[deskProjectId],
	);

	const deskRow = await client.query<{ id: string }>(
		`insert into service_desks
		 (source_id, project_id, portal_name, description, open_access)
		 values ($1, $2, $3, $4, true) returning id`,
		[`test:${run}:panels-desk`, deskProjectId, `Panels portal ${run}`, null],
	);
	const deskId = deskRow.rows[0].id;
	const requestType = await client.query<{ id: string }>(
		`insert into request_types
		 (source_id, desk_id, name, description, help_text, icon_name, sequence)
		 values ($1, $2, $3, null, null, null, 0) returning id`,
		[`test:${run}:panels-request-type`, deskId, `Panels request ${run}`],
	);
	await client.query(
		`update issues set request_type_id = $1, request_channel = 'portal'
		 where key = $2`,
		[requestType.rows[0].id, deskIssueKey],
	);

	const calendar = await client.query<{ id: string }>(
		`insert into sla_calendars
		 (source_id, name, timezone, working_hours, holidays)
		 values ($1, $2, 'UTC', '[]'::jsonb, '[]'::jsonb) returning id`,
		[calendarSource, `Panels calendar ${run}`],
	);
	const metric = await client.query<{ id: string }>(
		`insert into sla_metrics
		 (source_id, desk_id, name, customer_visible, start_conditions,
		  pause_conditions, stop_conditions)
		 values ($1, $2, $3, true, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
		 returning id`,
		[`test:${run}:panels-metric`, deskId, `Panels SLA ${run}`],
	);
	await client.query(
		`insert into sla_goals
		 (source_id, metric_id, jql, goal_minutes, calendar_id, sequence)
		 values ($1, $2, $3, 60, $4, 0)`,
		[
			`test:${run}:panels-goal`,
			metric.rows[0].id,
			`project = ${deskKey}`,
			calendar.rows[0].id,
		],
	);
	const [deskIssue] = (
		await client.query<{ id: string }>("select id from issues where key = $1", [
			deskIssueKey,
		])
	).rows;
	await client.query(
		`insert into sla_cycles
		 (issue_id, metric_id, cycle_number, started_at, stopped_at,
		  paused_intervals, goal_minutes, elapsed_minutes, breached)
		 values ($1, $2, 1, now() - interval '2 hours', now() - interval '1 hour',
		  '[]'::jsonb, 60, 30, false)`,
		[deskIssue.id, metric.rows[0].id],
	);

	const hidden = await createProjectFixture(client, {
		run: hiddenRun,
		key: hiddenKey,
		name: `Panels hidden ${run}`,
		issues: [{ summary: "Panels hidden issue" }],
	});
	hiddenProjectId = hidden.projectId;
	hiddenIssueKey = hidden.issueKeys[0];
	await client.query(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb)`,
		[
			hiddenScheme,
			`Panels hidden scheme ${run}`,
			JSON.stringify([hiddenProjectId]),
		],
	);

	const repository = await client.query<{ id: string }>(
		`insert into gitlab_repositories
		 (gitlab_project_id, path, name, web_url)
		 values ($1, $2, $3, $4) returning id`,
		[
			9_000_000 + Number.parseInt(run.slice(0, 6), 16),
			`team/${run}/panels`,
			`panels-${run}`,
			`https://gitlab.example.test/team/${run}/panels`,
		],
	);
	repositoryId = repository.rows[0].id;
	const branch = await client.query<{ id: string }>(
		`insert into gitlab_branches
		 (repository_id, name, web_url, last_commit_sha)
		 values ($1, $2, $3, $4) returning id`,
		[
			repositoryId,
			`${softwareIssueKey}-panels-branch`,
			`https://gitlab.example.test/team/${run}/panels/-/tree/panels`,
			"a".repeat(40),
		],
	);
	const [softwareIssue] = (
		await client.query<{ id: string }>("select id from issues where key = $1", [
			softwareIssueKey,
		])
	).rows;
	await client.query(
		`insert into gitlab_branch_issues (branch_id, issue_id) values ($1, $2)`,
		[branch.rows[0].id, softwareIssue.id],
	);
	await client.query(
		`insert into gitlab_project_repositories (project_id, repository_id)
		 values ($1, $2)`,
		[softwareProjectId, repositoryId],
	);
});

afterAll(async () => {
	if (!client) return;
	await client.query("delete from gitlab_repositories where id = $1", [
		repositoryId,
	]);
	await client.query("delete from permission_schemes where source_id = $1", [
		hiddenScheme,
	]);
	await dropProjectFixture(client, softwareRun);
	await dropProjectFixture(client, deskRun);
	await dropProjectFixture(client, hiddenRun);
	await client.query("delete from sla_calendars where source_id = $1", [
		calendarSource,
	]);
	await cleanupTestData(run);
	await client.end();
	await pool.end();
});

test("a visible issue returns its development and request panels", async () => {
	const panels = await loadIssuePanels(actor, softwareIssueKey.toLowerCase());

	expect(panels.development.counts.branches).toBe(1);
	expect(panels.development.branches[0]?.name).toBe(
		`${softwareIssueKey}-panels-branch`,
	);
	expect(panels.request).toEqual({
		requestType: null,
		channel: null,
		portalId: null,
		customerUrl: null,
		isAgent: false,
	});
	expect(panels.sla).toBeNull();
});

test("an agent sees the request type and the SLA; another viewer sees no SLA", async () => {
	const panels = await loadIssuePanels(actor, deskIssueKey);

	expect(panels.request.requestType?.name).toBe(`Panels request ${run}`);
	expect(panels.request.channel).toBe("portal");
	expect(panels.request.customerUrl).toBe(
		`/servicedesk/customer/portal/${panels.request.portalId}/${deskIssueKey}`,
	);
	expect(panels.request.isAgent).toBe(true);
	expect(panels.sla?.metrics).toHaveLength(1);
	expect(panels.sla?.metrics[0]?.cycles[0]?.state).toBe("completed");

	const viewerPanels = await loadIssuePanels(viewer, deskIssueKey);
	expect(viewerPanels.request.requestType?.name).toBe(`Panels request ${run}`);
	expect(viewerPanels.request.isAgent).toBe(false);
	expect(viewerPanels.sla).toBeNull();
});

test("an issue the actor may not browse is a 404", async () => {
	await expect(loadIssuePanels(actor, hiddenIssueKey)).rejects.toSatisfy(
		(cause: unknown) => isHttpError(cause) && cause.status === 404,
	);
});
