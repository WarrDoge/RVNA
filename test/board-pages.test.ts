import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	boardSprintSummary,
	updateBoardSwimlanes,
} from "../src/lib/server/agile/service.ts";
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
const hiddenKey = `ZZ${run.slice(0, 5).toUpperCase()}`;
const exposureToken = `EXPOSURE-${run}`;
const rapidViewId = 990_000 + Number.parseInt(run.slice(0, 4), 16);
const projectlessRapidViewId = rapidViewId + 1;

let app: TestApp;
let client: Client;
let owner: TestUser;
let admin: TestUser;
let visible: SeedResult;
let hidden: SeedResult;
let boardId: string;
let projectlessBoardId: string;
let sprintId: string;

function actor(user: TestUser, isAdmin = false): CurrentUser {
	return {
		id: user.id,
		username: user.username,
		displayName: `Test ${user.username}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin,
		mustChangePassword: false,
		hasPassword: true,
	};
}

async function boardRow(id: string) {
	const result = await pool.query<{
		sub_filter_jql: string | null;
		swimlane_strategy: string;
	}>("select sub_filter_jql, swimlane_strategy from boards where id = $1", [
		id,
	]);
	return result.rows[0];
}

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	app = buildServer();

	owner = await makeUser(run, "owner");
	admin = await makeUser(run, "admin");
	visible = await createProjectFixture(client, {
		run: `${run}vis`,
		key: visibleKey,
		issues: [
			{ summary: `Visible todo one ${run}`, status: "todo" },
			{ summary: `Visible todo two ${run}`, status: "todo" },
			{ summary: `Visible done ${run}`, status: "done" },
		],
		members: [owner.username],
		admins: [admin.username],
	});
	hidden = await createProjectFixture(client, {
		run: `${run}hid`,
		key: hiddenKey,
		issues: [{ summary: `Hidden issue ${run}` }],
	});
	await db.insert(permissionSchemes).values({
		sourceId: `${run}:hidden-scheme`,
		name: `Hidden scheme ${run}`,
		projectIds: [hidden.projectId],
		raw: {},
	});

	const board = await client.query<{ id: string }>(
		`insert into boards
			(rapid_view_id, source_id, name, type, filter_jql, project_id, owner_id,
			 config_imported)
		 values ($1, $2, $3, 'kanban', $4, $5, $6, true)
		 returning id`,
		[
			rapidViewId,
			`${run}:board`,
			"Board pages fixture",
			`project = ${visibleKey} and summary ~ "${exposureToken}"`,
			visible.projectId,
			owner.id,
		],
	);
	boardId = board.rows[0].id;
	for (const [sequence, name, statusId] of [
		[0, "To Do", visible.statusIds.todo],
		[1, "Done", visible.statusIds.done],
	] as const) {
		const column = await client.query<{ id: string }>(
			`insert into board_columns (board_id, name, sequence)
			 values ($1, $2, $3) returning id`,
			[boardId, name, sequence],
		);
		await client.query(
			`insert into board_column_statuses (column_id, status_id, sequence)
			 values ($1, $2, 0)`,
			[column.rows[0].id, statusId],
		);
	}

	const projectless = await client.query<{ id: string }>(
		`insert into boards
			(rapid_view_id, source_id, name, type, filter_jql, project_id, owner_id,
			 config_imported)
		 values ($1, $2, $3, 'kanban', $4, null, $5, true)
		 returning id`,
		[
			projectlessRapidViewId,
			`${run}:projectless-board`,
			"Projectless fixture board",
			`project = ${visibleKey}`,
			owner.id,
		],
	);
	projectlessBoardId = projectless.rows[0].id;
	for (const [sequence, name, statusId] of [
		[0, "To Do", visible.statusIds.todo],
		[1, "Done", visible.statusIds.done],
	] as const) {
		const column = await client.query<{ id: string }>(
			`insert into board_columns (board_id, name, sequence)
			 values ($1, $2, $3) returning id`,
			[projectlessBoardId, name, sequence],
		);
		await client.query(
			`insert into board_column_statuses (column_id, status_id, sequence)
			 values ($1, $2, 0)`,
			[column.rows[0].id, statusId],
		);
	}

	const sprint = await client.query<{ id: string }>(
		`insert into sprints
			(source_id, board_id, name, state, start_date, end_date, sequence)
		 values ($1, $2, $3, 'active', now(), now() + interval '14 days', 0)
		 returning id`,
		[`${run}:sprint`, boardId, "Board pages sprint"],
	);
	sprintId = sprint.rows[0].id;
	for (const issueId of visible.issueIds) {
		await client.query(
			`insert into issue_sprints (issue_id, sprint_id, is_open)
			 values ($1, $2, true)`,
			[issueId, sprintId],
		);
	}
});

afterAll(async () => {
	if (!client) return;
	await client.query("delete from boards where source_id like $1", [
		`${run}:%`,
	]);
	await client.query("delete from sprints where source_id = $1", [
		`${run}:sprint`,
	]);
	await client.query("delete from permission_schemes where source_id = $1", [
		`${run}:hidden-scheme`,
	]);
	await dropProjectFixture(client, `${run}vis`);
	await dropProjectFixture(client, `${run}hid`);
	await client.end();
	await app.close();
	await pool.end();
});

describe("board page loads", () => {
	test("a projectless board renders a board-only sidebar", async () => {
		const response = await injectAs(
			app,
			owner.session,
			"GET",
			`/boards/${projectlessRapidViewId}/work`,
		);
		expect(response.statusCode).toBe(200);
		const body = response.body;
		expect(body).toContain("Projectless fixture board");
		expect(body).not.toContain("/projects//issues");
		expect(body).not.toContain("/projects//reports");
	});

	test("a project administrator sees the board configuration enabled", async () => {
		const response = await injectAs(
			app,
			admin.session,
			"GET",
			`/secure/RapidView.jspa?rapidView=${rapidViewId}&tab=general`,
		);
		expect(response.statusCode).toBe(200);
		expect(response.body).not.toContain(
			"Only administrators and the board owner",
		);
		expect(response.body).toContain('aria-label="Board name"');
		expect(response.body).toMatch(/<title>Board pages fixture - /);
	});

	test("the boards list and board configuration render their page titles", async () => {
		const list = await injectAs(
			app,
			owner.session,
			"GET",
			"/secure/ManageRapidViews.jspa",
		);
		expect(list.body).toMatch(/<title>Boards - /);
	});

	test("reports and releases reject a float rapidView id without a 500", async () => {
		for (const address of ["/boards/1.5/reports", "/boards/1.5/releases"]) {
			const response = await injectAs(app, owner.session, "GET", address);
			expect({ address, status: response.statusCode }).toEqual({
				address,
				status: 200,
			});
			expect(response.body).toContain("Board not found");
		}
	});

	test("reports returns a board ref, not the board configuration", async () => {
		const response = await injectAs(
			app,
			owner.session,
			"GET",
			`/boards/${rapidViewId}/reports`,
		);
		expect(response.statusCode).toBe(200);
		expect(response.body).not.toContain(exposureToken);
	});

	test("the project reports placeholder hides a project the actor cannot browse", async () => {
		const response = await injectAs(
			app,
			owner.session,
			"GET",
			`/projects/${hiddenKey}/reports`,
		);
		expect(response.statusCode).toBe(404);
	});

	test("a non-uuid version id renders not found instead of failing the cast", async () => {
		const response = await injectAs(
			app,
			owner.session,
			"GET",
			`/projects/${visibleKey}/versions/not-a-uuid`,
		);
		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("Version not found");
	});
});

describe("board configuration writes", () => {
	test("an invalid sub-filter is rejected before it is saved", async () => {
		const response = await injectAs(
			app,
			owner.session,
			"PATCH",
			`/api/boards/${rapidViewId}`,
			{ subFilterJql: "project =" },
		);
		expect(response.statusCode).toBe(400);
		expect((await boardRow(boardId)).sub_filter_jql).toBeNull();
	});

	test("a swimlane strategy and its lanes save in one transaction", async () => {
		await expect(
			updateBoardSwimlanes(actor(owner), rapidViewId, {
				swimlaneStrategy: "queries",
				swimlanes: [{ name: "Broken lane", jql: "project =" }],
			}),
		).rejects.toThrow();
		expect((await boardRow(boardId)).swimlane_strategy).toBe("none");
	});
});

describe("sprint summary", () => {
	test("counts every issue in the active sprint, not only the filtered board", async () => {
		await pool.query("update boards set type = 'scrum' where id = $1", [
			boardId,
		]);
		await client.query(
			`insert into sprints (source_id, board_id, name, state, sequence)
			 values ($1, $2, $3, 'future', 1)`,
			[`${run}:future-sprint`, boardId, "Future fixture sprint"],
		);
		const summary = await boardSprintSummary(actor(owner), rapidViewId);
		expect(summary.completed).toBe(1);
		expect(summary.incomplete).toBe(2);
		expect(summary.futureSprints.map((sprint) => sprint.name)).toEqual([
			"Future fixture sprint",
		]);
	});
});
