import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getBacklogAssignees } from "../src/lib/server/agile/service.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	boards,
	issueSprints,
	issues,
	issueTypes,
	permissionGrants,
	permissionSchemes,
	projectIssueTypes,
	projectRoleActors,
	projects,
	projectWorkflows,
	sprints,
	statuses,
	users,
	workflowStatuses,
	workflows,
	workflowTransitions,
} from "../src/lib/server/schema.ts";
import { searchIssues } from "../src/lib/server/search/service.ts";
import { makeUser } from "./admin-helpers.ts";
import {
	adminGroup,
	buildServer,
	cleanupTestData,
	grantDefaultProjectRole,
	login,
} from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const tag = `agile-api-${run}`;
const projectKey = `A${run.slice(0, 6).toUpperCase()}`;
const otherProjectKey = `B${run.slice(0, 6).toUpperCase()}`;

let app: TestApp;
let ownerSession: string;
let otherSession: string;
let adminSession: string;
let projectId: string;
let otherProjectId: string;
let taskTypeId: string;
let epicTypeId: string;
let todoStatusId: string;
let blockedStatusId: string;
let progressStatusId: string;
let doneStatusId: string;
let workflowId: string;
let scrumBoard: {
	id: string;
	rapidViewId: number;
	columns: {
		id: string;
		name: string;
		statuses: { id: string; name: string }[];
	}[];
};
let configBoard: { id: string; rapidViewId: number };
let kanbanBoard: {
	id: string;
	rapidViewId: number;
	columns: {
		id: string;
		name: string;
		statuses: { id: string; name: string }[];
	}[];
};
let sprint1Id: string;
let sprint2Id: string;
const issueIds: Record<string, string> = {};
const issueKeys: Record<string, string> = {};

function inject(
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	url: string,
	session: string | null,
	payload?: unknown,
) {
	return app.inject({
		method,
		url,
		cookies: session ? { sid: session } : undefined,
		headers: {
			...(session ? { "x-requested-with": "rvna" } : {}),
		},
		payload: payload as never,
	});
}

async function createIssue(
	session: string,
	summary: string,
	rank: string,
	project = projectKey,
) {
	const response = await inject("POST", "/api/issues", session, {
		project,
		type: taskTypeId,
		summary,
	});
	expect(response.statusCode).toBe(201);
	const body = response.json() as { id: string; key: string };
	await db.update(issues).set({ rank }).where(eq(issues.id, body.id));
	return body;
}

async function createSprint(name: string) {
	const response = await inject(
		"POST",
		`/api/boards/${scrumBoard.rapidViewId}/sprints`,
		ownerSession,
		{ name },
	);
	expect(response.statusCode).toBe(201);
	return response.json() as { id: string; name: string; state: string };
}

async function startSprint(id: string) {
	const response = await inject(
		"POST",
		`/api/sprints/${id}/start`,
		ownerSession,
		{
			startDate: new Date().toISOString(),
			endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
		},
	);
	expect(response.statusCode).toBe(200);
	return response.json();
}

async function move(
	session: string,
	body: Record<string, unknown>,
	rapidViewId = scrumBoard.rapidViewId,
) {
	return inject("POST", `/api/boards/${rapidViewId}/move`, session, body);
}

/** Waits until the database reports at least `count` sessions blocked on a board or sprint lock. */
async function waitForLockWaiters(count: number) {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const result = await pool.query<{ n: number }>(
			`select count(*)::int as n from pg_stat_activity
			 where datname = current_database() and wait_event_type = 'Lock'`,
		);
		if ((result.rows[0]?.n ?? 0) >= count) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`timed out waiting for ${count} lock waiters`);
}

async function boardData(query = "", rapidViewId = scrumBoard.rapidViewId) {
	const response = await inject(
		"GET",
		`/api/boards/${rapidViewId}/data${query}`,
		ownerSession,
	);
	expect(response.statusCode).toBe(200);
	return response.json() as {
		activeSprint: { id: string; name: string } | null;
		columns: {
			id: string;
			name: string;
			statuses: { id: string; name: string }[];
		}[];
		swimlanes: {
			name: string | null;
			issues: { key: string; status: { name: string } }[];
		}[];
		total: number;
	};
}

function keys(data: Awaited<ReturnType<typeof boardData>>) {
	return data.swimlanes.flatMap((lane) =>
		lane.issues.map((issue) => issue.key),
	);
}

async function historyCount(key: string) {
	const result = await pool.query(
		`select count(*)::int as count from issue_history h
		 join issues i on i.id = h.issue_id where i.key = $1`,
		[key],
	);
	return result.rows[0].count as number;
}

async function cleanup() {
	const projectRows = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.key, projectKey));
	for (const project of projectRows) {
		await pool.query("delete from boards where project_id = $1", [project.id]);
		await pool.query("delete from issues where project_id = $1", [project.id]);
		await pool.query("delete from projects where id = $1", [project.id]);
	}
	const otherRows = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.key, otherProjectKey));
	for (const project of otherRows) {
		await pool.query("delete from issues where project_id = $1", [project.id]);
		await pool.query("delete from projects where id = $1", [project.id]);
	}
	await pool.query("delete from workflows where source_id like $1", [
		`${tag}%`,
	]);
	await pool.query("delete from statuses where source_id like $1", [`${tag}%`]);
	await pool.query("delete from issue_types where source_id like $1", [
		`${tag}%`,
	]);
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();
	app = buildServer();

	const owner = await login(app, {
		sub: `${tag}-owner`,
		username: `t-${run}-owner`,
		name: "Agile Owner",
		email: `t-${run}-owner@example.test`,
		groups: [],
	});
	ownerSession = owner.sessionId as string;
	const other = await login(app, {
		sub: `${tag}-other`,
		username: `t-${run}-other`,
		name: "Agile Other",
		email: `t-${run}-other@example.test`,
		groups: [],
	});
	otherSession = other.sessionId as string;
	const admin = await login(app, {
		sub: `${tag}-admin`,
		username: `t-${run}-admin`,
		name: "Agile Admin",
		email: `t-${run}-admin@example.test`,
		groups: [adminGroup()],
	});
	adminSession = admin.sessionId as string;

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project`,
			key: projectKey,
			name: "Agile API fixture",
			projectType: "software",
		})
		.returning();
	projectId = project.id;
	await grantDefaultProjectRole(
		projectId,
		[`t-${run}-owner`, `t-${run}-other`],
		"member",
	);
	const [otherProject] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:other-project`,
			key: otherProjectKey,
			name: "Other agile fixture",
			projectType: "software",
		})
		.returning();
	otherProjectId = otherProject.id;
	await grantDefaultProjectRole(otherProjectId, [`t-${run}-owner`], "member");

	const typeRows = await db
		.insert(issueTypes)
		.values([
			{ sourceId: `${tag}:task`, name: "Task" },
			{ sourceId: `${tag}:epic`, name: "Epic" },
		])
		.returning();
	taskTypeId = typeRows[0].id;
	epicTypeId = typeRows[1].id;

	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}:todo`, name: "To Do", category: "new" },
			{ sourceId: `${tag}:blocked`, name: "Blocked", category: "new" },
			{
				sourceId: `${tag}:progress`,
				name: "In Progress",
				category: "indeterminate",
			},
			{ sourceId: `${tag}:done`, name: "Done", category: "done" },
		])
		.returning();
	todoStatusId = statusRows[0].id;
	blockedStatusId = statusRows[1].id;
	progressStatusId = statusRows[2].id;
	doneStatusId = statusRows[3].id;

	const [workflow] = await db
		.insert(workflows)
		.values({ sourceId: `${tag}:workflow`, name: `${tag} workflow` })
		.returning();
	workflowId = workflow.id;
	await db.insert(workflowStatuses).values(
		statusRows.map((status) => ({
			workflowId,
			statusId: status.id,
		})),
	);
	await db.insert(workflowTransitions).values([
		{
			sourceId: `${tag}:todo-progress`,
			workflowId,
			name: "Start progress",
			fromStatusId: todoStatusId,
			toStatusId: progressStatusId,
			sequence: 0,
		},
		{
			sourceId: `${tag}:todo-blocked`,
			workflowId,
			name: "Block",
			fromStatusId: todoStatusId,
			toStatusId: blockedStatusId,
			sequence: 1,
		},
		{
			sourceId: `${tag}:blocked-progress`,
			workflowId,
			name: "Unblock",
			fromStatusId: blockedStatusId,
			toStatusId: progressStatusId,
			sequence: 2,
		},
		{
			sourceId: `${tag}:progress-done`,
			workflowId,
			name: "Finish",
			fromStatusId: progressStatusId,
			toStatusId: doneStatusId,
			sequence: 3,
		},
		{
			sourceId: `${tag}:done-progress`,
			workflowId,
			name: "Reopen",
			fromStatusId: doneStatusId,
			toStatusId: progressStatusId,
			sequence: 4,
		},
	]);
	await db.insert(projectWorkflows).values({
		sourceId: `${tag}:project-workflow`,
		projectId,
		issueTypeId: null,
		workflowId,
	});
	await db.insert(projectWorkflows).values({
		sourceId: `${tag}:other-project-workflow`,
		projectId: otherProjectId,
		issueTypeId: null,
		workflowId,
	});
	await db.insert(projectIssueTypes).values(
		[taskTypeId, epicTypeId].map((typeId) => ({
			sourceId: `${tag}:project-type:${typeId}`,
			projectId,
			issueTypeId: typeId,
		})),
	);
	await db.insert(projectIssueTypes).values({
		sourceId: `${tag}:other-project-type`,
		projectId: otherProjectId,
		issueTypeId: taskTypeId,
	});

	const boardResponse = await inject("POST", "/api/boards", ownerSession, {
		name: "Agile test board",
		type: "scrum",
		filterJql: `project = ${projectKey}`,
		project: projectKey,
	});
	expect(boardResponse.statusCode).toBe(201);
	scrumBoard = boardResponse.json();
});

afterAll(async () => {
	await cleanup();
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

describe("boards", () => {
	test("creates a board with derived columns and enforces configuration permissions", async () => {
		expect(scrumBoard.columns.map((column) => column.name)).toEqual([
			"To Do",
			"In Progress",
			"Done",
		]);
		expect(scrumBoard.columns[0].statuses.map((status) => status.name)).toEqual(
			["Blocked", "To Do"],
		);

		const list = await inject("GET", "/api/boards", ownerSession);
		expect(list.statusCode).toBe(200);
		expect(
			(list.json() as { rapidViewId: number }[]).some(
				(board) => board.rapidViewId === scrumBoard.rapidViewId,
			),
		).toBe(true);

		const denied = await inject(
			"PATCH",
			`/api/boards/${scrumBoard.rapidViewId}`,
			otherSession,
			{ name: "Hijacked" },
		);
		expect(denied.statusCode).toBe(403);

		const offered = async (session: string) =>
			(
				(await inject("GET", "/api/boards", session)).json() as {
					rapidViewId: number;
					canAdminister: boolean;
				}[]
			).find((board) => board.rapidViewId === scrumBoard.rapidViewId)
				?.canAdminister;
		expect(await offered(ownerSession)).toBe(true);
		expect(await offered(adminSession)).toBe(true);
		expect(await offered(otherSession)).toBe(false);

		const owner = await inject(
			"PATCH",
			`/api/boards/${scrumBoard.rapidViewId}`,
			ownerSession,
			{ name: "Agile test board" },
		);
		expect(owner.statusCode).toBe(200);

		const admin = await inject(
			"PATCH",
			`/api/boards/${scrumBoard.rapidViewId}`,
			adminSession,
			{ name: "Agile test board" },
		);
		expect(admin.statusCode).toBe(200);
	});

	test("rejects a filter that does not compile", async () => {
		const response = await inject("POST", "/api/boards", ownerSession, {
			name: "Broken board",
			type: "scrum",
			filterJql: "project =",
			project: projectKey,
		});
		expect(response.statusCode).toBe(400);
	});

	test("a column derivation failure does not leave a board behind", async () => {
		const name = `Failing board ${run}`;
		await pool.query(`
			create or replace function test_fail_board_columns() returns trigger
			language plpgsql as $$
			begin
				if exists (select 1 from boards where id = new.board_id and name = '${name}') then
					raise exception 'column derivation failed';
				end if;
				return new;
			end $$`);
		await pool.query(
			"create trigger test_fail_board_columns before insert on board_columns for each row execute function test_fail_board_columns()",
		);
		try {
			const response = await inject("POST", "/api/boards", ownerSession, {
				name,
				type: "scrum",
				filterJql: `project = ${projectKey}`,
				project: projectKey,
			});
			expect(response.statusCode).toBe(500);
			const rows = await db
				.select({ id: boards.id })
				.from(boards)
				.where(eq(boards.name, name));
			expect(rows).toHaveLength(0);
		} finally {
			await pool.query(
				"drop trigger if exists test_fail_board_columns on board_columns",
			);
			await pool.query("drop function if exists test_fail_board_columns()");
		}
	});
});

describe("board data and moves", () => {
	test("shows the active sprint in rank order and filters", async () => {
		const a = await createIssue(ownerSession, "Agile issue A", "0|a");
		const b = await createIssue(ownerSession, "Agile issue B", "0|b");
		const c = await createIssue(ownerSession, "Agile issue C", "0|c");
		const d = await createIssue(ownerSession, "Agile issue D", "0|d");
		issueIds.A = a.id;
		issueIds.B = b.id;
		issueIds.C = c.id;
		issueIds.D = d.id;
		issueKeys.A = a.key;
		issueKeys.B = b.key;
		issueKeys.C = c.key;
		issueKeys.D = d.key;
		await createIssue(ownerSession, "Agile backlog issue", "0|e");

		const sprint = await createSprint("Agile Sprint One");
		sprint1Id = sprint.id;
		await startSprint(sprint.id);
		for (const key of ["A", "B", "C", "D"]) {
			const response = await move(ownerSession, {
				issues: [issueKeys[key]],
				sprintId: sprint.id,
			});
			expect(response.statusCode).toBe(200);
		}

		const data = await boardData();
		expect(data.activeSprint?.id).toBe(sprint.id);
		expect(keys(data)).toEqual([
			`${projectKey}-1`,
			`${projectKey}-2`,
			`${projectKey}-3`,
			`${projectKey}-4`,
		]);

		const search = await searchIssues(
			{
				jql: `project = ${projectKey} AND sprint in openSprints() ORDER BY key ASC`,
				startAt: 0,
				maxResults: 50,
			},
			{
				id: "00000000-0000-0000-0000-000000000000",
				username: "nobody",
				isAdmin: true,
			},
		);
		expect(search.issues.map((issue) => issue.key)).toEqual([
			`${projectKey}-1`,
			`${projectKey}-2`,
			`${projectKey}-3`,
			`${projectKey}-4`,
		]);

		const filtered = await boardData("?text=issue%20B");
		expect(keys(filtered)).toEqual([`${projectKey}-2`]);

		const quick = await inject(
			"PUT",
			`/api/boards/${scrumBoard.rapidViewId}/quick-filters`,
			ownerSession,
			{
				quickFilters: [
					{ name: "Only my issues", jql: "assignee = currentUser()" },
				],
			},
		);
		expect(quick.statusCode).toBe(200);
		const quickId = (quick.json() as { quickFilters: { id: string }[] })
			.quickFilters[0].id;
		const assigned = await inject(
			"PATCH",
			`/api/issues/${projectKey}-1`,
			ownerSession,
			{ assignee: (await inject("GET", "/api/me", ownerSession)).json().id },
		);
		expect(assigned.statusCode).toBe(200);
		const quickData = await boardData(`?quickFilter=${quickId}`);
		expect(keys(quickData)).toEqual([`${projectKey}-1`]);
	});

	test("rejects an over-long quick filter value", async () => {
		const response = await inject(
			"GET",
			`/api/boards/${scrumBoard.rapidViewId}/data?quickFilter=${"x".repeat(2001)}`,
			ownerSession,
		);
		expect(response.statusCode).toBe(400);
	});

	test("reorders and ranks issues without writing history", async () => {
		const before = await historyCount(`${projectKey}-3`);
		const response = await move(ownerSession, {
			issues: [`${projectKey}-3`],
			sprintId: sprint1Id,
			before: `${projectKey}-1`,
		});
		expect(response.statusCode).toBe(200);
		const data = await boardData();
		expect(keys(data)).toEqual([
			`${projectKey}-3`,
			`${projectKey}-1`,
			`${projectKey}-2`,
			`${projectKey}-4`,
		]);
		expect(await historyCount(`${projectKey}-3`)).toBe(before);

		const group = await move(ownerSession, {
			issues: [`${projectKey}-1`, `${projectKey}-2`],
			sprintId: sprint1Id,
			after: `${projectKey}-4`,
		});
		expect(group.statusCode).toBe(200);
		const grouped = await boardData();
		expect(keys(grouped)).toEqual([
			`${projectKey}-3`,
			`${projectKey}-4`,
			`${projectKey}-1`,
			`${projectKey}-2`,
		]);

		const bounded = await move(ownerSession, {
			issues: [`${projectKey}-2`],
			sprintId: sprint1Id,
			before: `${projectKey}-1`,
			after: `${projectKey}-3`,
		});
		expect(bounded.statusCode).toBe(200);
		const boundedData = await boardData();
		expect(keys(boundedData)).toEqual([
			`${projectKey}-3`,
			`${projectKey}-2`,
			`${projectKey}-4`,
			`${projectKey}-1`,
		]);
	});

	test("rejects a before and after pair that is not in the target list", async () => {
		const outside = await createIssue(
			ownerSession,
			"Anchor outside the sprint",
			"0|outside",
		);
		const response = await move(ownerSession, {
			issues: [`${projectKey}-4`],
			sprintId: sprint1Id,
			before: outside.key,
			after: outside.key,
		});
		expect(response.statusCode).toBe(400);
		await db.delete(issues).where(eq(issues.id, outside.id));
	});

	test("a multi-issue epic move sets the epic on every issue", async () => {
		const epic = await inject("POST", "/api/issues", ownerSession, {
			project: projectKey,
			type: epicTypeId,
			summary: "Move epic",
		});
		expect(epic.statusCode).toBe(201);
		const epicKey = epic.json().key as string;
		const epicId = epic.json().id as string;
		const sprint = await createSprint("Epic move sprint");
		const first = await createIssue(ownerSession, "Epic move one", "0|em1");
		const second = await createIssue(ownerSession, "Epic move two", "0|em2");
		const response = await move(ownerSession, {
			issues: [first.key, second.key],
			sprintId: sprint.id,
			epic: epicKey,
		});
		expect(response.statusCode).toBe(200);
		const rows = await db
			.select({ id: issues.id, epicId: issues.epicId })
			.from(issues)
			.where(inArray(issues.id, [first.id, second.id]));
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.epicId === epicId)).toBe(true);
		await db.delete(sprints).where(eq(sprints.id, sprint.id));
		await db
			.delete(issues)
			.where(inArray(issues.id, [first.id, second.id, epicId]));
	});

	test("a column-only move puts the issue into the active sprint", async () => {
		const issue = await createIssue(ownerSession, "Column only issue", "0|co");
		const progress = scrumBoard.columns.find(
			(column) => column.name === "In Progress",
		);
		if (!progress) throw new Error("The In Progress column is missing");
		const response = await move(ownerSession, {
			issues: [issue.key],
			columnId: progress.id,
			statusId: progressStatusId,
		});
		expect(response.statusCode).toBe(200);
		const memberships = await db
			.select({ sprintId: issueSprints.sprintId, isOpen: issueSprints.isOpen })
			.from(issueSprints)
			.where(
				and(eq(issueSprints.issueId, issue.id), eq(issueSprints.isOpen, true)),
			);
		expect(memberships).toEqual([{ sprintId: sprint1Id, isOpen: true }]);
		await db.delete(issues).where(eq(issues.id, issue.id));
	});

	test("transitions on drop and rejects unreachable columns", async () => {
		const progressColumn = scrumBoard.columns.find(
			(column) => column.name === "In Progress",
		);
		const doneColumn = scrumBoard.columns.find(
			(column) => column.name === "Done",
		);
		const todoColumn = scrumBoard.columns.find(
			(column) => column.name === "To Do",
		);
		if (!progressColumn || !doneColumn || !todoColumn) {
			throw new Error("Board columns are missing");
		}

		const moved = await move(ownerSession, {
			issues: [`${projectKey}-1`],
			sprintId: sprint1Id,
			columnId: progressColumn.id,
		});
		expect(moved.statusCode).toBe(200);
		let data = await boardData();
		expect(
			data.swimlanes
				.flatMap((lane) => lane.issues)
				.find((issue) => issue.key === `${projectKey}-1`)?.status.name,
		).toBe("In Progress");

		const finished = await move(ownerSession, {
			issues: [`${projectKey}-1`],
			sprintId: sprint1Id,
			columnId: doneColumn.id,
		});
		expect(finished.statusCode).toBe(200);
		data = await boardData();
		expect(
			data.swimlanes
				.flatMap((lane) => lane.issues)
				.find((issue) => issue.key === `${projectKey}-1`)?.status.name,
		).toBe("Done");
		expect(await historyCount(`${projectKey}-1`)).toBeGreaterThan(0);

		const invalid = await move(ownerSession, {
			issues: [`${projectKey}-2`],
			sprintId: sprint1Id,
			columnId: doneColumn.id,
		});
		expect(invalid.statusCode).toBe(400);
		const invalidBody = invalid.json() as {
			validColumns: { id: string; name: string }[];
		};
		expect(
			invalidBody.validColumns.map((column) => column.name).sort(),
		).toEqual(["In Progress", "To Do"]);

		const ambiguous = await move(ownerSession, {
			issues: [`${projectKey}-1`],
			sprintId: sprint1Id,
			columnId: todoColumn.id,
		});
		expect(ambiguous.statusCode).toBe(400);
		expect(
			(ambiguous.json() as { statuses: { name: string }[] }).statuses.map(
				(status) => status.name,
			),
		).toEqual(["Blocked", "To Do"]);

		const blocked = await move(ownerSession, {
			issues: [`${projectKey}-2`],
			sprintId: sprint1Id,
			columnId: todoColumn.id,
			statusId: blockedStatusId,
		});
		expect(blocked.statusCode).toBe(200);
		data = await boardData();
		expect(
			data.swimlanes
				.flatMap((lane) => lane.issues)
				.find((issue) => issue.key === `${projectKey}-2`)?.status.name,
		).toBe("Blocked");
	});

	test("rejects moves for issues outside the board filter", async () => {
		const other = await createIssue(
			ownerSession,
			"Other project issue",
			"0|a",
			otherProjectKey,
		);
		const response = await move(ownerSession, {
			issues: [other.key],
			sprintId: sprint1Id,
		});
		expect(response.statusCode).toBe(400);
	});

	test("a column-only move still needs the scheduling permission", async () => {
		const viewer = await makeUser(run, "viewer");
		await grantDefaultProjectRole(projectId, [viewer.username], "viewer");
		const issue = await createIssue(ownerSession, "Rank guard issue", "0|z");
		const todo = scrumBoard.columns.find((column) => column.name === "To Do");
		if (!todo) throw new Error("The To Do column is missing");

		const response = await move(viewer.session, {
			issues: [issue.key],
			columnId: todo.id,
		});
		expect(response.statusCode).toBe(403);
		expect(response.json().error).toMatch(/SCHEDULE_ISSUES/);

		const [stored] = await db
			.select({ rank: issues.rank })
			.from(issues)
			.where(eq(issues.id, issue.id));
		expect(stored?.rank).toBe("0|z");
	});
});

describe("sprints", () => {
	test("rejects an inverted sprint date range on create and update", async () => {
		const start = new Date().toISOString();
		const end = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		const created = await inject(
			"POST",
			`/api/boards/${scrumBoard.rapidViewId}/sprints`,
			ownerSession,
			{ name: "Inverted sprint", startDate: start, endDate: end },
		);
		expect(created.statusCode).toBe(400);

		const sprint = await createSprint("Patchable sprint");
		const patched = await inject(
			"PATCH",
			`/api/sprints/${sprint.id}`,
			ownerSession,
			{ startDate: start, endDate: end },
		);
		expect(patched.statusCode).toBe(400);
	});

	test("starts one sprint at a time and completes with counts", async () => {
		const second = await createSprint("Agile Sprint Two");
		sprint2Id = second.id;
		await createIssue(ownerSession, "Agile issue E", "0|f");
		await move(ownerSession, {
			issues: [`${projectKey}-3`],
			sprintId: sprint1Id,
		});

		const secondStart = await inject(
			"POST",
			`/api/sprints/${sprint2Id}/start`,
			ownerSession,
			{
				startDate: new Date().toISOString(),
				endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
			},
		);
		expect(secondStart.statusCode).toBe(400);

		const complete = await inject(
			"POST",
			`/api/sprints/${sprint1Id}/complete`,
			ownerSession,
			{ moveToSprintId: sprint2Id },
		);
		expect(complete.statusCode).toBe(200);
		const result = complete.json() as {
			completed: number;
			incomplete: number;
			movedToSprintId: string;
			sprint: { state: string };
		};
		expect(result.sprint.state).toBe("closed");
		expect(result.completed).toBe(1);
		expect(result.incomplete).toBe(3);
		expect(result.movedToSprintId).toBe(sprint2Id);

		const memberships = await db
			.select({ isOpen: issueSprints.isOpen, sprintId: issueSprints.sprintId })
			.from(issueSprints)
			.where(eq(issueSprints.issueId, issueIds.B));
		expect(memberships.filter((row) => row.isOpen)).toHaveLength(1);
		expect(memberships.find((row) => row.isOpen)?.sprintId).toBe(sprint2Id);

		const data = await boardData();
		expect(data.activeSprint).toBeNull();
		expect(keys(data)).toEqual([]);

		await startSprint(sprint2Id);
		const active = await boardData();
		expect(active.activeSprint?.id).toBe(sprint2Id);

		const completeBacklog = await inject(
			"POST",
			`/api/sprints/${sprint2Id}/complete`,
			ownerSession,
			{},
		);
		expect(completeBacklog.statusCode).toBe(200);
		const backlog = await inject(
			"GET",
			`/api/boards/${scrumBoard.rapidViewId}/backlog`,
			ownerSession,
		);
		expect(backlog.statusCode).toBe(200);
		const backlogKeys = (
			backlog.json() as { backlog: { issues: { key: string }[] } }
		).backlog.issues.map((issue) => issue.key);
		expect(backlogKeys).toEqual(
			expect.arrayContaining([`${projectKey}-2`, `${projectKey}-3`]),
		);

		const deleteActive = await inject(
			"DELETE",
			`/api/sprints/${sprint2Id}`,
			ownerSession,
		);
		expect(deleteActive.statusCode).toBe(400);

		const future = await createSprint("Agile Sprint Three");
		const deleted = await inject(
			"DELETE",
			`/api/sprints/${future.id}`,
			ownerSession,
		);
		expect(deleted.statusCode).toBe(204);
	});

	test("a sprint removed during completion does not crash the answer", async () => {
		const sprint = await createSprint("Disappearing sprint");
		await startSprint(sprint.id);
		const issue = await createIssue(
			ownerSession,
			"Disappearing sprint issue",
			"0|ds",
		);
		await move(ownerSession, { issues: [issue.key], sprintId: sprint.id });
		const functionName = `test_delete_closed_sprint_${run}`;
		await pool.query(`
			create or replace function ${functionName}() returns trigger
			language plpgsql as $$
			begin
				if new.id = '${sprint.id}' and new.state = 'closed' then
					delete from sprints where id = new.id;
				end if;
				return new;
			end $$`);
		await pool.query(
			`create trigger ${functionName} after update on sprints for each row execute function ${functionName}()`,
		);
		try {
			const response = await inject(
				"POST",
				`/api/sprints/${sprint.id}/complete`,
				ownerSession,
				{},
			);
			expect(response.statusCode).toBe(200);
		} finally {
			await pool.query(`drop trigger if exists ${functionName} on sprints`);
			await pool.query(`drop function if exists ${functionName}()`);
			await db.delete(issues).where(eq(issues.id, issue.id));
		}
	});

	test("issues moved into a sprint during completion are counted and moved", {
		timeout: 15000,
	}, async () => {
		const late = await createIssue(ownerSession, "Late sprint issue", "0|late");
		const first = await createSprint("Race close first");
		const second = await createSprint("Race close second");
		await startSprint(first.id);
		const locker = await pool.connect();
		try {
			await locker.query("begin");
			await locker.query("select id from boards where id = $1 for update", [
				scrumBoard.id,
			]);
			await locker.query("select id from sprints where id = $1 for update", [
				first.id,
			]);
			const completing = inject(
				"POST",
				`/api/sprints/${first.id}/complete`,
				ownerSession,
				{ moveToSprintId: second.id },
			);
			await waitForLockWaiters(1);
			await locker.query(
				"insert into issue_sprints (issue_id, sprint_id, is_open) values ($1, $2, true)",
				[late.id, first.id],
			);
			await locker.query("commit");
			const response = await completing;
			expect(response.statusCode).toBe(200);
			const target = await db
				.select({ isOpen: issueSprints.isOpen })
				.from(issueSprints)
				.where(
					and(
						eq(issueSprints.issueId, late.id),
						eq(issueSprints.sprintId, second.id),
					),
				);
			expect(target).toEqual([{ isOpen: true }]);
		} finally {
			await locker.query("rollback").catch(() => undefined);
			locker.release();
		}
	});

	test("deleting a future sprint twice at once reports the second as missing", {
		timeout: 15000,
	}, async () => {
		const sprint = await createSprint("Race delete sprint");
		const locker = await pool.connect();
		try {
			await locker.query("begin");
			await locker.query("select id from boards where id = $1 for update", [
				scrumBoard.id,
			]);
			await locker.query("select id from sprints where id = $1 for update", [
				sprint.id,
			]);
			const first = inject("DELETE", `/api/sprints/${sprint.id}`, ownerSession);
			const second = inject(
				"DELETE",
				`/api/sprints/${sprint.id}`,
				ownerSession,
			);
			await waitForLockWaiters(2);
			await locker.query("commit");
			const responses = await Promise.all([first, second]);
			expect(responses.map((response) => response.statusCode).sort()).toEqual([
				204, 404,
			]);
		} finally {
			await locker.query("rollback").catch(() => undefined);
			locker.release();
		}
	});

	test("concurrent sprint creates get distinct sequences", async () => {
		const responses = await Promise.all(
			Array.from({ length: 10 }, (_, index) =>
				inject(
					"POST",
					`/api/boards/${scrumBoard.rapidViewId}/sprints`,
					ownerSession,
					{ name: `Concurrent sprint ${index}` },
				),
			),
		);
		expect(responses.map((response) => response.statusCode)).toEqual(
			Array(10).fill(201),
		);
		const sequences = responses.map(
			(response) => (response.json() as { sequence: number }).sequence,
		);
		expect(new Set(sequences).size).toBe(10);
	});

	test("rejects an end date before the stored start date", async () => {
		const start = new Date().toISOString();
		const end = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		const sprint = await createSprint("Stored start sprint");
		const dated = await inject(
			"PATCH",
			`/api/sprints/${sprint.id}`,
			ownerSession,
			{
				startDate: start,
			},
		);
		expect(dated.statusCode).toBe(200);
		const endOnly = await inject(
			"PATCH",
			`/api/sprints/${sprint.id}`,
			ownerSession,
			{ endDate: end },
		);
		expect(endOnly.statusCode).toBe(400);
	});

	test("moving to an unknown or closed sprint is a 400", async () => {
		const issue = await createIssue(ownerSession, "Bad sprint issue", "0|bad");
		const unknown = await move(ownerSession, {
			issues: [issue.key],
			sprintId: randomUUID(),
		});
		expect(unknown.statusCode).toBe(400);
		expect(unknown.json().error).toBe("Unknown sprint");

		const [closed] = await db
			.insert(sprints)
			.values({
				boardId: scrumBoard.id,
				name: "Closed sprint",
				state: "closed",
				sequence: 999,
			})
			.returning();
		const refused = await move(ownerSession, {
			issues: [issue.key],
			sprintId: closed.id,
		});
		expect(refused.statusCode).toBe(400);
		expect(refused.json().error).toBe("The sprint is closed");
	});

	test("keeps at most one open sprint per issue", async () => {
		const first = await createSprint("Agile Sprint Four");
		const second = await createSprint("Agile Sprint Five");
		const issue = await createIssue(ownerSession, "Agile issue F", "0|g");
		const firstMove = await move(ownerSession, {
			issues: [issue.key],
			sprintId: first.id,
		});
		expect(firstMove.statusCode).toBe(200);
		const secondMove = await move(ownerSession, {
			issues: [issue.key],
			sprintId: second.id,
		});
		expect(secondMove.statusCode).toBe(200);
		const open = await db
			.select()
			.from(issueSprints)
			.where(eq(issueSprints.issueId, issue.id));
		expect(open.filter((row) => row.isOpen)).toHaveLength(1);
		expect(open.find((row) => row.isOpen)?.sprintId).toBe(second.id);

		await expect(
			db.insert(issueSprints).values({
				issueId: issue.id,
				sprintId: first.id,
				isOpen: true,
			}),
		).rejects.toThrow();
	});
});

describe("configuration", () => {
	test("updates columns, swimlanes, quick filters and estimation", async () => {
		const created = await inject("POST", "/api/boards", ownerSession, {
			name: "Agile config board",
			type: "scrum",
			filterJql: `project = ${projectKey}`,
			project: projectKey,
		});
		expect(created.statusCode).toBe(201);
		configBoard = created.json();

		const duplicate = await inject(
			"PUT",
			`/api/boards/${configBoard.rapidViewId}/columns`,
			ownerSession,
			{
				columns: [
					{ name: "One", statuses: [todoStatusId, todoStatusId] },
					{ name: "Two", statuses: [progressStatusId] },
				],
			},
		);
		expect(duplicate.statusCode).toBe(400);

		const empty = await inject(
			"PUT",
			`/api/boards/${configBoard.rapidViewId}/columns`,
			ownerSession,
			{ columns: [] },
		);
		expect(empty.statusCode).toBe(400);

		const columns = await inject(
			"PUT",
			`/api/boards/${configBoard.rapidViewId}/columns`,
			ownerSession,
			{
				columns: [
					{
						name: "To Do",
						statuses: [todoStatusId, blockedStatusId],
						minIssues: 1,
					},
					{ name: "Doing", statuses: [progressStatusId], maxIssues: 2 },
					{ name: "Done", statuses: [doneStatusId] },
				],
			},
		);
		expect(columns.statusCode).toBe(200);
		expect(
			(columns.json() as { columns: { name: string }[] }).columns.map(
				(column) => column.name,
			),
		).toEqual(["To Do", "Doing", "Done"]);

		const badSwimlane = await inject(
			"PUT",
			`/api/boards/${configBoard.rapidViewId}/swimlanes`,
			ownerSession,
			{ swimlanes: [{ name: "Bad", jql: "status =" }] },
		);
		expect(badSwimlane.statusCode).toBe(400);

		const swimlanes = await inject(
			"PUT",
			`/api/boards/${configBoard.rapidViewId}/swimlanes`,
			ownerSession,
			{
				swimlanes: [
					{ name: "Blocked lane", jql: 'summary ~ "Agile config issue"' },
				],
			},
		);
		expect(swimlanes.statusCode).toBe(200);

		const patched = await inject(
			"PATCH",
			`/api/boards/${configBoard.rapidViewId}`,
			ownerSession,
			{
				swimlaneStrategy: "queries",
				estimationField: "issue_count",
				cardColourStrategy: "priority",
			},
		);
		expect(patched.statusCode).toBe(200);

		const issue = await createIssue(ownerSession, "Agile config issue", "0|z");
		await db
			.update(issues)
			.set({ statusId: blockedStatusId })
			.where(eq(issues.id, issue.id));
		const sprint = await inject(
			"POST",
			`/api/boards/${configBoard.rapidViewId}/sprints`,
			ownerSession,
			{ name: "Config sprint" },
		);
		const sprintId = (sprint.json() as { id: string }).id;
		await inject("POST", `/api/sprints/${sprintId}/start`, ownerSession, {
			startDate: new Date().toISOString(),
			endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		});
		await move(
			ownerSession,
			{ issues: [issue.key], sprintId },
			configBoard.rapidViewId,
		);
		const data = await boardData("", configBoard.rapidViewId);
		expect(data.swimlanes[0].name).toBe("Blocked lane");
		expect(data.swimlanes[0].issues.map((row) => row.key)).toEqual([issue.key]);
	});

	test("a database failure while replacing columns is not a validation error", async () => {
		const functionName = `test_fail_replace_columns_${run}`;
		await pool.query(`
			create or replace function ${functionName}() returns trigger
			language plpgsql as $$
			begin
				if new.board_id = '${configBoard.id}' then
					raise exception 'column replacement failed';
				end if;
				return new;
			end $$`);
		await pool.query(
			`create trigger ${functionName} before insert on board_columns for each row execute function ${functionName}()`,
		);
		try {
			const response = await inject(
				"PUT",
				`/api/boards/${configBoard.rapidViewId}/columns`,
				ownerSession,
				{ columns: [{ name: "Only", statuses: [todoStatusId] }] },
			);
			expect(response.statusCode).toBe(500);
		} finally {
			await pool.query(
				`drop trigger if exists ${functionName} on board_columns`,
			);
			await pool.query(`drop function if exists ${functionName}()`);
		}
	});

	test("a broken stored filter is a 400 for the assignee choices", async () => {
		const [owner] = await db
			.select({
				id: users.id,
				username: users.username,
				displayName: users.displayName,
			})
			.from(users)
			.where(eq(users.username, `t-${run}-owner`))
			.limit(1);
		if (!owner) throw new Error("The owner is missing");
		await db
			.update(boards)
			.set({ filterJql: "project =" })
			.where(eq(boards.id, configBoard.id));
		try {
			await expect(
				getBacklogAssignees(
					{
						id: owner.id,
						username: owner.username,
						displayName: owner.displayName,
						email: null,
						avatarUrl: null,
						groups: [],
						isAdmin: false,
						mustChangePassword: false,
						hasPassword: true,
					},
					configBoard.rapidViewId,
				),
			).rejects.toMatchObject({ status: 400 });
		} finally {
			await db
				.update(boards)
				.set({ filterJql: `project = ${projectKey}` })
				.where(eq(boards.id, configBoard.id));
		}
	});
});

describe("kanban", () => {
	test("moves the configured backlog status off the board and into the backlog", async () => {
		const created = await inject("POST", "/api/boards", ownerSession, {
			name: "Agile kanban board",
			type: "kanban",
			filterJql: `project = ${projectKey}`,
			project: projectKey,
		});
		expect(created.statusCode).toBe(201);
		kanbanBoard = created.json();

		const patched = await inject(
			"PATCH",
			`/api/boards/${kanbanBoard.rapidViewId}`,
			ownerSession,
			{ kanbanBacklogStatusId: blockedStatusId },
		);
		expect(patched.statusCode).toBe(200);

		const issue = await createIssue(
			ownerSession,
			"Kanban backlog issue",
			"0|k",
		);
		await db
			.update(issues)
			.set({ statusId: blockedStatusId })
			.where(eq(issues.id, issue.id));

		const data = await boardData("", kanbanBoard.rapidViewId);
		expect(keys(data)).not.toContain(issue.key);

		const backlog = await inject(
			"GET",
			`/api/boards/${kanbanBoard.rapidViewId}/backlog`,
			ownerSession,
		);
		expect(backlog.statusCode).toBe(200);
		const backlogKeys = (
			backlog.json() as { backlog: { issues: { key: string }[] } }
		).backlog.issues.map((row) => row.key);
		expect(backlogKeys).toContain(issue.key);

		const progressColumn = kanbanBoard.columns.find(
			(column) => column.name === "In Progress",
		);
		if (!progressColumn) throw new Error("Kanban column is missing");
		const moved = await move(
			ownerSession,
			{ issues: [issue.key], columnId: progressColumn.id },
			kanbanBoard.rapidViewId,
		);
		expect(moved.statusCode).toBe(200);
		const after = await boardData("", kanbanBoard.rapidViewId);
		expect(keys(after)).toContain(issue.key);
	});
});

describe("epic visibility", () => {
	const hiddenKey = `C${run.slice(0, 6).toUpperCase()}`;
	let hiddenProjectId: string;
	let hiddenEpicId: string;
	let hiddenEpicKey: string;
	let linkedIssue: { id: string; key: string };

	beforeAll(async () => {
		const [hiddenProject] = await db
			.insert(projects)
			.values({
				sourceId: `${tag}:hidden-project`,
				key: hiddenKey,
				name: "Hidden epic project",
				projectType: "software",
			})
			.returning({ id: projects.id });
		hiddenProjectId = hiddenProject.id;
		const [scheme] = await db
			.insert(permissionSchemes)
			.values({
				sourceId: `${tag}:hidden-scheme`,
				name: "Hidden epic scheme",
				projectIds: [hiddenProjectId],
				raw: {},
			})
			.returning({ id: permissionSchemes.id });
		await db.insert(permissionGrants).values({
			sourceId: `${tag}:hidden-browse`,
			schemeId: scheme.id,
			permissionKey: "BROWSE_PROJECTS",
			holderType: "projectRole",
			holderParameter: "member",
			raw: {},
		});
		await db.insert(projectRoleActors).values({
			sourceId: `${tag}:hidden-member`,
			projectId: hiddenProjectId,
			roleId: "member",
			roleName: "member",
			actorType: "user",
			actorParameter: `t-${run}-owner`,
			actorDisplayName: `Agile Owner`,
			raw: {},
		});
		const [epic] = await db
			.insert(issues)
			.values({
				sourceId: `${tag}:hidden-epic`,
				projectId: hiddenProjectId,
				number: 1,
				key: `${hiddenKey}-1`,
				typeId: epicTypeId,
				statusId: todoStatusId,
				summary: "Hidden epic summary",
				rank: "0|a",
			})
			.returning({ id: issues.id, key: issues.key });
		hiddenEpicId = epic.id;
		hiddenEpicKey = epic.key;
		linkedIssue = await createIssue(
			otherSession,
			"Epic visibility linked issue",
			"0|z",
		);
		await db
			.update(issues)
			.set({ epicId: hiddenEpicId, parentId: hiddenEpicId })
			.where(eq(issues.id, linkedIssue.id));
	});

	afterAll(async () => {
		await pool.query("delete from issues where project_id = $1", [
			hiddenProjectId,
		]);
		await pool.query("delete from projects where id = $1", [hiddenProjectId]);
		await pool.query("delete from permission_grants where source_id = $1", [
			`${tag}:hidden-browse`,
		]);
		await pool.query("delete from permission_schemes where source_id = $1", [
			`${tag}:hidden-scheme`,
		]);
	});

	test("the board reader hides an epic the viewer cannot browse", async () => {
		const hidden = await inject(
			"GET",
			`/api/boards/${kanbanBoard.rapidViewId}/data`,
			otherSession,
		);
		expect(hidden.statusCode).toBe(200);
		const hiddenIssue = (
			hidden.json() as {
				swimlanes: { issues: { key: string; epic: unknown }[] }[];
			}
		).swimlanes
			.flatMap((lane) => lane.issues)
			.find((issue) => issue.key === linkedIssue.key);
		expect(hiddenIssue?.epic).toBeNull();

		const visible = await inject(
			"GET",
			`/api/boards/${kanbanBoard.rapidViewId}/data`,
			ownerSession,
		);
		const visibleIssue = (
			visible.json() as {
				swimlanes: {
					issues: { key: string; epic: { key: string } | null }[];
				}[];
			}
		).swimlanes
			.flatMap((lane) => lane.issues)
			.find((issue) => issue.key === linkedIssue.key);
		expect(visibleIssue?.epic?.key).toBe(hiddenEpicKey);
	});

	test("the navigator reader hides an epic the viewer cannot browse", async () => {
		const jql = encodeURIComponent(`key = ${linkedIssue.key}`);
		const hidden = await inject(
			"GET",
			`/api/search/issues?jql=${jql}`,
			otherSession,
		);
		expect(hidden.statusCode).toBe(200);
		expect(
			(hidden.json() as { issues: { epic: unknown }[] }).issues[0]?.epic,
		).toBeNull();

		const visible = await inject(
			"GET",
			`/api/search/issues?jql=${jql}`,
			ownerSession,
		);
		expect(
			(visible.json() as { issues: { epic: { key: string } | null }[] })
				.issues[0]?.epic?.key,
		).toBe(hiddenEpicKey);
	});

	test("the navigator hides a parent the viewer cannot browse", async () => {
		const jql = encodeURIComponent(`key = ${linkedIssue.key}`);
		const hidden = await inject(
			"GET",
			`/api/search/issues?jql=${jql}`,
			otherSession,
		);
		expect(hidden.statusCode).toBe(200);
		expect(
			(hidden.json() as { issues: { parent: unknown }[] }).issues[0]?.parent,
		).toBeNull();

		const visible = await inject(
			"GET",
			`/api/search/issues?jql=${jql}`,
			ownerSession,
		);
		expect(
			(visible.json() as { issues: { parent: { key: string } | null }[] })
				.issues[0]?.parent?.key,
		).toBe(hiddenEpicKey);
	});

	test("every epic-link writer refuses an epic the actor cannot browse", async () => {
		const updated = await inject(
			"PATCH",
			`/api/issues/${linkedIssue.key}`,
			otherSession,
			{ epic: hiddenEpicKey },
		);
		expect(updated.statusCode).toBe(404);

		const created = await inject("POST", "/api/issues", otherSession, {
			project: projectKey,
			type: taskTypeId,
			summary: "Epic visibility create",
			epic: hiddenEpicKey,
		});
		expect(created.statusCode).toBe(404);

		const moved = await move(
			otherSession,
			{ issues: [linkedIssue.key], epic: hiddenEpicKey },
			kanbanBoard.rapidViewId,
		);
		expect(moved.statusCode).toBe(404);

		const allowed = await inject(
			"PATCH",
			`/api/issues/${linkedIssue.key}`,
			ownerSession,
			{ epic: hiddenEpicKey },
		);
		expect(allowed.statusCode).toBe(200);
	});
});

test("EDIT_SPRINT_NAME_AND_GOAL and START_STOP_SPRINTS gate sprint fields", async () => {
	const key = `S${run.slice(0, 6).toUpperCase()}`;
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:sprint-permission-project`,
			key,
			name: "Sprint permission project",
			projectType: "software",
		})
		.returning();
	await db.insert(projectWorkflows).values({
		sourceId: `${tag}:sprint-permission-workflow`,
		projectId: project.id,
		issueTypeId: null,
		workflowId,
	});
	await db.insert(projectIssueTypes).values({
		sourceId: `${tag}:sprint-permission-type`,
		projectId: project.id,
		issueTypeId: taskTypeId,
	});
	await grantDefaultProjectRole(project.id, [`t-${run}-other`], "member");
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `${tag}:sprint-permission-scheme`,
			name: "Sprint permission scheme",
			projectIds: [project.id],
			raw: {},
		})
		.returning();
	const baseGrants = [
		{
			sourceId: `${tag}:sprint-permission-browse`,
			schemeId: scheme.id,
			permissionKey: "BROWSE_PROJECTS",
			holderType: "anyone",
			holderParameter: null,
			raw: {},
		},
		{
			sourceId: `${tag}:sprint-permission-edit`,
			schemeId: scheme.id,
			permissionKey: "EDIT_SPRINT_NAME_AND_GOAL_PERMISSION",
			holderType: "projectRole",
			holderParameter: "member",
			raw: {},
		},
		{
			sourceId: `${tag}:sprint-permission-start`,
			schemeId: scheme.id,
			permissionKey: "START_STOP_SPRINTS_PERMISSION",
			holderType: "projectRole",
			holderParameter: "member",
			raw: {},
		},
	];
	await db.insert(permissionGrants).values(baseGrants);

	let rapidViewId = 0;
	try {
		const board = await inject("POST", "/api/boards", ownerSession, {
			name: "Sprint permission board",
			type: "scrum",
			filterJql: `project = ${key}`,
			project: key,
		});
		expect(board.statusCode).toBe(201);
		rapidViewId = (board.json() as { rapidViewId: number }).rapidViewId;

		const created = await inject(
			"POST",
			`/api/boards/${rapidViewId}/sprints`,
			ownerSession,
			{ name: "Sprint one" },
		);
		expect(created.statusCode).toBe(201);
		const sprintId = (created.json() as { id: string }).id;

		const renamed = await inject(
			"PATCH",
			`/api/sprints/${sprintId}`,
			otherSession,
			{
				name: "Sprint one renamed",
				goal: "A goal",
			},
		);
		expect(renamed.statusCode).toBe(200);
		expect(renamed.json()).toMatchObject({
			name: "Sprint one renamed",
			goal: "A goal",
		});

		const dated = await inject(
			"PATCH",
			`/api/sprints/${sprintId}`,
			otherSession,
			{
				startDate: new Date().toISOString(),
			},
		);
		expect(dated.statusCode).toBe(403);

		await pool.query("delete from permission_grants where source_id = $1", [
			`${tag}:sprint-permission-edit`,
		]);
		const deniedRename = await inject(
			"PATCH",
			`/api/sprints/${sprintId}`,
			otherSession,
			{ name: "Sprint one again" },
		);
		expect(deniedRename.statusCode).toBe(403);

		const started = await inject(
			"POST",
			`/api/sprints/${sprintId}/start`,
			otherSession,
			{
				startDate: new Date().toISOString(),
				endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
			},
		);
		expect(started.statusCode).toBe(200);

		const completed = await inject(
			"POST",
			`/api/sprints/${sprintId}/complete`,
			otherSession,
			{},
		);
		expect(completed.statusCode).toBe(200);

		const second = await inject(
			"POST",
			`/api/boards/${rapidViewId}/sprints`,
			ownerSession,
			{ name: "Sprint two" },
		);
		expect(second.statusCode).toBe(201);
		const secondId = (second.json() as { id: string }).id;
		const deniedStartRename = await inject(
			"POST",
			`/api/sprints/${secondId}/start`,
			otherSession,
			{
				name: "Sprint two renamed",
				startDate: new Date().toISOString(),
				endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
			},
		);
		expect(deniedStartRename.statusCode).toBe(403);
		const startedSecond = await inject(
			"POST",
			`/api/sprints/${secondId}/start`,
			otherSession,
			{
				startDate: new Date().toISOString(),
				endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
			},
		);
		expect(startedSecond.statusCode).toBe(200);
	} finally {
		if (rapidViewId > 0) {
			await pool.query("delete from boards where project_id = $1", [
				project.id,
			]);
		}
		await pool.query("delete from issues where project_id = $1", [project.id]);
		await pool.query("delete from permission_schemes where id = $1", [
			scheme.id,
		]);
		await pool.query("delete from projects where id = $1", [project.id]);
	}
});

describe("sprint ordering and archived projects", () => {
	test("concurrent sprint reorders keep sequences unique", async () => {
		const first = await createSprint("Race order first");
		const second = await createSprint("Race order second");
		const third = await createSprint("Race order third");
		const locker = await pool.connect();
		try {
			await locker.query("begin");
			await locker.query("select id from boards where id = $1 for update", [
				scrumBoard.id,
			]);
			await locker.query(
				"select id from sprints where id = any($1::uuid[]) for update",
				[[first.id, second.id, third.id]],
			);
			const down = inject(
				"POST",
				`/api/sprints/${first.id}/move`,
				ownerSession,
				{ direction: "down" },
			);
			const up = inject("POST", `/api/sprints/${third.id}/move`, ownerSession, {
				direction: "up",
			});
			await waitForLockWaiters(2);
			await locker.query("commit");
			const responses = await Promise.all([down, up]);
			expect(responses.map((response) => response.statusCode)).toEqual([
				200, 200,
			]);
			const rows = await pool.query<{ sequence: number }>(
				`select sequence from sprints
				 where board_id = $1 and state in ('active', 'future')
				 order by sequence, name`,
				[scrumBoard.id],
			);
			const sequences = rows.rows.map((row) => row.sequence);
			expect(new Set(sequences).size).toBe(sequences.length);
		} finally {
			await locker.query("rollback").catch(() => undefined);
			locker.release();
		}
	});

	test("an archived project rejects issue and sprint moves", async () => {
		const sprint = await createSprint("Archived project sprint");
		const issue = await createIssue(
			ownerSession,
			"Archived move issue",
			"0|arch",
		);
		await db
			.update(projects)
			.set({ archived: true })
			.where(eq(projects.id, projectId));
		try {
			const moved = await move(ownerSession, {
				issues: [issue.key],
				sprintId: null,
			});
			expect(moved.statusCode).toBe(403);
			const reordered = await inject(
				"POST",
				`/api/sprints/${sprint.id}/move`,
				ownerSession,
				{ direction: "up" },
			);
			expect(reordered.statusCode).toBe(403);
		} finally {
			await db
				.update(projects)
				.set({ archived: false })
				.where(eq(projects.id, projectId));
		}
	});
});
