import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { boardSprintSummary } from "../src/lib/server/agile/service.ts";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { permissionSchemes } from "../src/lib/server/schema.ts";
import { injectAs, makeUser, type TestUser } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
	type SeedResult,
} from "./fixtures/project.ts";
import { buildServer } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = fixtureRun();
const visibleKey = fixtureKey(run);
const hiddenKey = `PH${run.slice(0, 5).toUpperCase()}`;
const visibleBoardRapidViewId = 970_000 + Number.parseInt(run.slice(0, 4), 16);
const hiddenBoardRapidViewId = visibleBoardRapidViewId + 1;
const projectlessHiddenRapidViewId = hiddenBoardRapidViewId + 1;
const visibleBoardName = `Visible private board ${run}`;
const hiddenBoardName = `Hidden private board ${run}`;
const projectlessHiddenSprintName = `Hidden projectless sprint ${run}`;

let app: TestApp;
let client: Client;
let owner: TestUser;
let outsider: TestUser;
let visible: SeedResult;
let hidden: SeedResult;
let epicTypeId: string;
let visibleEpicKey: string;
let hiddenEpicKey: string;
let visibleSprintIssueKey: string;
let hiddenSprintIssueKey: string;
let visibleBacklogIssueKey: string;
let hiddenBacklogIssueKey: string;
let visibleBoardId: string;
let hiddenBoardId: string;
let projectlessHiddenBoardId: string;
let activeSprintId: string;

function actor(user: TestUser): CurrentUser {
	return {
		id: user.id,
		username: user.username,
		displayName: `Test ${user.username}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: true,
	};
}

async function insertIssue(options: {
	project: SeedResult;
	number: number;
	summary: string;
	epicId?: string;
	isEpic?: boolean;
	storyPoints: number;
	status: string;
}) {
	const key = `${options.project.projectKey}-${options.number}`;
	const result = await client.query<{ id: string }>(
		`insert into issues
		 (source_id, project_id, number, key, type_id, status_id, priority_id,
		  epic_id, summary, description_source, story_points, created, updated)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
		 returning id`,
		[
			`test:${run}:issue:${options.project.projectKey}:${options.number}`,
			options.project.projectId,
			options.number,
			key,
			options.isEpic ? epicTypeId : options.project.typeIds.task,
			options.status === "done"
				? options.project.statusIds.done
				: options.project.statusIds.todo,
			options.project.priorityIds.high,
			options.epicId ?? null,
			options.summary,
			options.summary,
			options.storyPoints,
		],
	);
	return { id: result.rows[0].id, key };
}

async function insertBoard(options: {
	rapidViewId: number;
	name: string;
	projectId: string;
	filterJql: string;
	ownerId: string;
	columns?: { name: string; statusId: string }[];
}) {
	const board = await client.query<{ id: string }>(
		`insert into boards
		 (rapid_view_id, source_id, name, type, filter_jql, project_id, owner_id,
		  config_imported)
		 values ($1, $2, $3, 'scrum', $4, $5, $6, true)
		 returning id`,
		[
			options.rapidViewId,
			`test:${run}:board:${options.rapidViewId}`,
			options.name,
			options.filterJql,
			options.projectId,
			options.ownerId,
		],
	);
	const id = board.rows[0].id;
	for (const [sequence, column] of (options.columns ?? []).entries()) {
		const created = await client.query<{ id: string }>(
			`insert into board_columns (board_id, name, sequence)
			 values ($1, $2, $3) returning id`,
			[id, column.name, sequence],
		);
		await client.query(
			`insert into board_column_statuses (column_id, status_id, sequence)
			 values ($1, $2, 0)`,
			[created.rows[0].id, column.statusId],
		);
	}
	return id;
}

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	app = buildServer();
	owner = await makeUser(run, "owner");
	outsider = await makeUser(run, "outsider");

	visible = await createProjectFixture(client, {
		run: `${run}vis`,
		key: visibleKey,
		name: `Visible board project ${run}`,
		issues: [],
		members: [owner.username],
	});
	hidden = await createProjectFixture(client, {
		run: `${run}hid`,
		key: hiddenKey,
		name: `Hidden board project ${run}`,
		issues: [],
	});
	await db.insert(permissionSchemes).values({
		sourceId: `test:${run}:hidden-scheme`,
		name: `Hidden board scheme ${run}`,
		projectIds: [hidden.projectId],
		raw: {},
	});

	const epicType = await client.query<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, 'Epic', false) returning id`,
		[`test:${run}:epic-type`],
	);
	epicTypeId = epicType.rows[0].id;

	const visibleEpic = await insertIssue({
		project: visible,
		number: 100,
		summary: `Visible epic ${run}`,
		isEpic: true,
		storyPoints: 0,
		status: "todo",
	});
	visibleEpicKey = visibleEpic.key;
	const hiddenEpic = await insertIssue({
		project: hidden,
		number: 100,
		summary: `Hidden epic ${run}`,
		isEpic: true,
		storyPoints: 0,
		status: "todo",
	});
	hiddenEpicKey = hiddenEpic.key;
	const visibleSprintIssue = await insertIssue({
		project: visible,
		number: 101,
		summary: `Visible sprint issue ${run}`,
		epicId: visibleEpic.id,
		storyPoints: 3,
		status: "todo",
	});
	visibleSprintIssueKey = visibleSprintIssue.key;
	const hiddenSprintIssue = await insertIssue({
		project: hidden,
		number: 101,
		summary: `Hidden sprint issue ${run}`,
		epicId: hiddenEpic.id,
		storyPoints: 5,
		status: "todo",
	});
	hiddenSprintIssueKey = hiddenSprintIssue.key;
	const visibleBacklogIssue = await insertIssue({
		project: visible,
		number: 102,
		summary: `Visible backlog issue ${run}`,
		epicId: visibleEpic.id,
		storyPoints: 2,
		status: "todo",
	});
	visibleBacklogIssueKey = visibleBacklogIssue.key;
	const hiddenBacklogIssue = await insertIssue({
		project: hidden,
		number: 102,
		summary: `Hidden backlog issue ${run}`,
		epicId: hiddenEpic.id,
		storyPoints: 7,
		status: "todo",
	});
	hiddenBacklogIssueKey = hiddenBacklogIssue.key;

	visibleBoardId = await insertBoard({
		rapidViewId: visibleBoardRapidViewId,
		name: visibleBoardName,
		projectId: visible.projectId,
		filterJql: "created >= 2020-01-01 ORDER BY key ASC",
		ownerId: owner.id,
		columns: [
			{ name: "To Do", statusId: visible.statusIds.todo },
			{ name: "Done", statusId: visible.statusIds.done },
		],
	});
	hiddenBoardId = await insertBoard({
		rapidViewId: hiddenBoardRapidViewId,
		name: hiddenBoardName,
		projectId: hidden.projectId,
		filterJql: `project = ${hiddenKey} ORDER BY key ASC`,
		ownerId: owner.id,
	});
	const projectlessHidden = await client.query<{ id: string }>(
		`insert into boards
			(rapid_view_id, source_id, name, type, filter_jql, project_id, owner_id,
			 config_imported)
		 values ($1, $2, $3, 'scrum', $4, null, $5, true)
		 returning id`,
		[
			projectlessHiddenRapidViewId,
			`test:${run}:projectless-hidden-board`,
			"Projectless hidden fixture board",
			`project = ${hiddenKey}`,
			owner.id,
		],
	);
	projectlessHiddenBoardId = projectlessHidden.rows[0].id;
	await client.query(
		`insert into sprints (source_id, board_id, name, state, sequence)
		 values ($1, $2, $3, 'future', 0)`,
		[
			`test:${run}:projectless-hidden-sprint`,
			projectlessHiddenBoardId,
			projectlessHiddenSprintName,
		],
	);

	const sprint = await client.query<{ id: string }>(
		`insert into sprints
		 (source_id, board_id, name, state, start_date, end_date, sequence)
		 values ($1, $2, $3, 'active', now(), now() + interval '14 days', 0)
		 returning id`,
		[`test:${run}:sprint`, visibleBoardId, `Active sprint ${run}`],
	);
	activeSprintId = sprint.rows[0].id;
	await client.query(
		`insert into issue_sprints (issue_id, sprint_id, is_open)
		 values ($1, $2, true), ($3, $2, true)`,
		[visibleSprintIssue.id, activeSprintId, hiddenSprintIssue.id],
	);
	await client.query(
		`insert into sprints
		 (source_id, board_id, name, state, sequence)
		 values ($1, $2, $3, 'future', 1)`,
		[`test:${run}:future-sprint`, visibleBoardId, `Future sprint ${run}`],
	);
});

afterAll(async () => {
	if (!client) return;
	await client.query("delete from boards where id = any($1::uuid[])", [
		[visibleBoardId, hiddenBoardId, projectlessHiddenBoardId].filter(Boolean),
	]);
	await client.query("delete from sprints where source_id like $1", [
		`test:${run}:sprint%`,
	]);
	await client.query("delete from permission_schemes where source_id = $1", [
		`test:${run}:hidden-scheme`,
	]);
	await dropProjectFixture(client, `${run}vis`);
	await dropProjectFixture(client, `${run}hid`);
	await client.query("delete from issue_types where id = $1", [epicTypeId]);
	await client.query("delete from audit_log where actor_id = $1", [owner.id]);
	await client.end();
	await app.close();
	await pool.end();
});

async function boardData(
	session: string,
	rapidViewId = visibleBoardRapidViewId,
) {
	const response = await injectAs(
		app,
		session,
		"GET",
		`/api/boards/${rapidViewId}/data`,
	);
	expect(response.statusCode).toBe(200);
	return response.json() as {
		total: number;
		swimlanes: { issues: { key: string; epic: { key: string } | null }[] }[];
	};
}

async function backlog(session: string) {
	const response = await injectAs(
		app,
		session,
		"GET",
		`/api/boards/${visibleBoardRapidViewId}/backlog`,
	);
	expect(response.statusCode).toBe(200);
	return response.json() as {
		sprints: {
			id: string;
			issues: { key: string; epic: { key: string } | null }[];
			totals: { new: number; indeterminate: number; done: number };
		}[];
		backlog: {
			issues: { key: string; epic: { key: string } | null }[];
			totals: { new: number; indeterminate: number; done: number };
		};
		epics: { key: string; issueCount: number; doneCount: number }[];
	};
}

function keys(issues: { key: string }[]) {
	return issues.map((issue) => issue.key);
}

test("a board only shows issues of projects the viewer may browse", async () => {
	const data = await boardData(owner.session);
	expect(data.total).toBe(1);
	expect(keys(data.swimlanes.flatMap((lane) => lane.issues))).toEqual([
		visibleSprintIssueKey,
	]);
	expect(JSON.stringify(data)).not.toContain(hiddenSprintIssueKey);
	expect(JSON.stringify(data)).not.toContain(`Hidden sprint issue ${run}`);

	const backlogData = await backlog(owner.session);
	const active = backlogData.sprints.find(
		(sprint) => sprint.id === activeSprintId,
	);
	expect(active).toBeDefined();
	expect(keys(active?.issues ?? [])).toEqual([visibleSprintIssueKey]);
	expect(active?.totals.new).toBe(3);
	expect(keys(backlogData.backlog.issues)).toEqual([
		visibleEpicKey,
		visibleBacklogIssueKey,
	]);
	expect(backlogData.backlog.totals.new).toBe(2);
	expect(backlogData.epics).toEqual([
		expect.objectContaining({
			key: visibleEpicKey,
			issueCount: 2,
			doneCount: 0,
		}),
	]);
	expect(JSON.stringify(backlogData)).not.toContain(hiddenSprintIssueKey);
	expect(JSON.stringify(backlogData)).not.toContain(hiddenBacklogIssueKey);
	expect(JSON.stringify(backlogData)).not.toContain(hiddenEpicKey);
	expect(JSON.stringify(backlogData)).not.toContain(
		`Hidden board project ${run}`,
	);

	const summary = await boardSprintSummary(
		actor(owner),
		visibleBoardRapidViewId,
	);
	expect(summary.completed).toBe(0);
	expect(summary.incomplete).toBe(1);

	const page = await injectAs(
		app,
		owner.session,
		"GET",
		`/boards/${visibleBoardRapidViewId}/work`,
	);
	expect(page.statusCode).toBe(200);
	expect(page.body).toContain(visibleSprintIssueKey);
	expect(page.body).not.toContain(hiddenSprintIssueKey);
	expect(page.body).not.toContain(`Hidden sprint issue ${run}`);
});

test("a board whose project the viewer cannot browse is not found", async () => {
	const list = await injectAs(app, owner.session, "GET", "/api/boards");
	expect(list.statusCode).toBe(200);
	const boardIds = (list.json() as { id: string }[]).map((board) => board.id);
	expect(boardIds).toContain(visibleBoardId);
	expect(boardIds).not.toContain(hiddenBoardId);

	for (const address of [
		`/api/boards/${hiddenBoardRapidViewId}`,
		`/api/boards/${hiddenBoardRapidViewId}/data`,
		`/api/boards/${hiddenBoardRapidViewId}/backlog`,
	]) {
		const response = await injectAs(app, owner.session, "GET", address);
		expect({ address, status: response.statusCode }).toEqual({
			address,
			status: 404,
		});
	}

	const boardPage = await injectAs(
		app,
		owner.session,
		"GET",
		`/boards/${hiddenBoardRapidViewId}/work`,
	);
	expect(boardPage.statusCode).toBe(200);
	expect(boardPage.body).toContain("Board not found");
	expect(boardPage.body).not.toContain(hiddenBoardName);

	const configPage = await injectAs(
		app,
		owner.session,
		"GET",
		`/secure/RapidView.jspa?rapidView=${hiddenBoardRapidViewId}`,
	);
	expect(configPage.statusCode).toBe(200);
	expect(configPage.body).toContain("Board not found");
	expect(configPage.body).not.toContain(hiddenBoardName);

	const listPage = await injectAs(
		app,
		owner.session,
		"GET",
		"/secure/ManageRapidViews.jspa",
	);
	expect(listPage.statusCode).toBe(200);
	expect(listPage.body).not.toContain(hiddenBoardName);
});

test("a report hides a projectless board the actor cannot open", async () => {
	const normal = await injectAs(
		app,
		outsider.session,
		"GET",
		`/api/boards/${projectlessHiddenRapidViewId}`,
	);
	expect(normal.statusCode).toBe(404);

	const report = await injectAs(
		app,
		outsider.session,
		"GET",
		`/api/boards/${projectlessHiddenRapidViewId}/reports/sprints`,
	);
	expect(report.statusCode).toBe(404);
	expect(report.body).not.toContain(projectlessHiddenSprintName);

	const ownerReport = await injectAs(
		app,
		owner.session,
		"GET",
		`/api/boards/${projectlessHiddenRapidViewId}/reports/sprints`,
	);
	expect(ownerReport.statusCode).toBe(200);
});

type BoardMutation = {
	label: string;
	method: "POST" | "PATCH" | "PUT";
	url: string;
	body: (jql: string) => unknown;
	successStatus: number;
};

const unknownKey = `NOPE${run.slice(0, 5).toUpperCase()}`;
const boardMutations: BoardMutation[] = [
	{
		label: "create board filter",
		method: "POST",
		url: "/api/boards",
		body: (jql) => ({
			name: `Filtered board ${run}`,
			type: "scrum",
			project: visibleKey,
			filterJql: jql,
		}),
		successStatus: 201,
	},
	{
		label: "update board filter",
		method: "PATCH",
		url: `/api/boards/${visibleBoardRapidViewId}`,
		body: (jql) => ({ filterJql: jql }),
		successStatus: 200,
	},
	{
		label: "update board sub-filter",
		method: "PATCH",
		url: `/api/boards/${visibleBoardRapidViewId}`,
		body: (jql) => ({ subFilterJql: jql }),
		successStatus: 200,
	},
	{
		label: "replace swimlanes",
		method: "PUT",
		url: `/api/boards/${visibleBoardRapidViewId}/swimlanes`,
		body: (jql) => ({ swimlanes: [{ name: "Lane", jql }] }),
		successStatus: 200,
	},
	{
		label: "replace quick filters",
		method: "PUT",
		url: `/api/boards/${visibleBoardRapidViewId}/quick-filters`,
		body: (jql) => ({ quickFilters: [{ name: "Filter", jql }] }),
		successStatus: 200,
	},
];

test("saving a board filter does not reveal a project the viewer cannot browse", async () => {
	for (const place of boardMutations) {
		const hidden = await injectAs(
			app,
			owner.session,
			place.method,
			place.url,
			place.body(`project = ${hiddenKey}`),
		);
		const unknown = await injectAs(
			app,
			owner.session,
			place.method,
			place.url,
			place.body(`project = ${unknownKey}`),
		);
		expect({ place: place.label, status: hidden.statusCode }).toEqual({
			place: place.label,
			status: 400,
		});
		expect({ place: place.label, status: unknown.statusCode }).toEqual({
			place: place.label,
			status: 400,
		});
		expect(hidden.json().error).toBe(
			unknown.json().error.replace(unknownKey, hiddenKey),
		);

		const saved = await injectAs(
			app,
			owner.session,
			place.method,
			place.url,
			place.body(`project = ${visibleKey}`),
		);
		expect({ place: place.label, status: saved.statusCode }).toEqual({
			place: place.label,
			status: place.successStatus,
		});
		if (place.method === "POST") {
			await injectAs(
				app,
				owner.session,
				"DELETE",
				`/api/boards/${saved.json().rapidViewId}`,
			);
		}
	}
});

test("the board swimlane form does not reveal a project the viewer cannot browse", async () => {
	async function save(jql: string) {
		return app.inject({
			method: "POST",
			url: `/secure/RapidView.jspa?rapidView=${visibleBoardRapidViewId}`,
			cookies: { sid: owner.session },
			headers: {
				"x-requested-with": "rvna",
				origin: "http://127.0.0.1:3000",
				"content-type": "application/x-www-form-urlencoded",
			},
			payload: new URLSearchParams({
				intent: "swimlanes",
				rapidView: String(visibleBoardRapidViewId),
				swimlaneStrategy: "queries",
				laneName: "Lane",
				laneJql: jql,
			}).toString(),
		});
	}

	const hidden = await save(`project = ${hiddenKey}`);
	const unknown = await save(`project = ${unknownKey}`);
	expect(hidden.statusCode).toBe(400);
	expect(unknown.statusCode).toBe(400);
	expect(hidden.body).toBe(unknown.body.replace(unknownKey, hiddenKey));

	const saved = await save(`project = ${visibleKey}`);
	expect(saved.statusCode).toBe(200);
	const rows = await client.query<{ jql: string }>(
		`select jql from board_swimlanes
		 where board_id = (select id from boards where rapid_view_id = $1)`,
		[visibleBoardRapidViewId],
	);
	expect(rows.rows.map((row) => row.jql)).toContain(`project = ${visibleKey}`);
});
