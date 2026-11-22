import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { HttpError } from "../src/lib/server/http.ts";
import {
	burndownReport,
	cumulativeFlowReport,
	sprintReport,
	velocityReport,
} from "../src/lib/server/reports/service.ts";
import { users } from "../src/lib/server/schema.ts";
import { makeUser, type TestUser } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
	type SeedResult,
} from "./fixtures/project.ts";
import { cleanupTestData } from "./helpers.ts";

const run = fixtureRun();
const tag = `reports-service-${run}`;
const projectKey = fixtureKey(run);
const rapidViewId = 980_000 + Number.parseInt(run.slice(0, 4), 16);

let client: Client;
let project: SeedResult;
let boardId: string;
let actor: CurrentUser;
let storySprintId: string;
let statusSprintId: string;
let timelineSprintId: string;
const issueIds: Record<string, string> = {};
const issueKeys: Record<string, string> = {};
let sameName: string;
let firstUserId: string;
let secondUserId: string;

function asActor(user: TestUser): CurrentUser {
	return {
		id: user.id,
		username: user.username,
		displayName: `Test ${user.username}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: true,
		mustChangePassword: false,
		hasPassword: true,
	};
}

async function insertSprint(options: {
	id?: string;
	name: string;
	state: "future" | "active" | "closed";
	startDate: string | null;
	endDate: string | null;
	completeDate: string | null;
	sequence: number;
}) {
	const result = await client.query<{ id: string }>(
		`insert into sprints
			(source_id, board_id, name, state, start_date, end_date, complete_date,
			 sequence)
		 values ($1, $2, $3, $4, $5, $6, $7, $8)
		 returning id`,
		[
			`${tag}:sprint:${options.name}`,
			boardId,
			options.name,
			options.state,
			options.startDate,
			options.endDate,
			options.completeDate,
			options.sequence,
		],
	);
	return result.rows[0].id;
}

async function addToSprint(issueId: string, sprintId: string) {
	await client.query(
		`insert into issue_sprints (issue_id, sprint_id, is_open)
		 values ($1, $2, false)`,
		[issueId, sprintId],
	);
}

async function history(
	issueId: string,
	created: string,
	items: {
		field: string;
		fromValue?: string | null;
		fromString?: string | null;
		toValue?: string | null;
		toString?: string | null;
	}[],
) {
	const [row] = (
		await client.query<{ id: string }>(
			`insert into issue_history (source_id, issue_id, created)
			 values ($1, $2, $3) returning id`,
			[`${tag}:history:${randomUUID()}`, issueId, created],
		)
	).rows;
	for (const [sequence, item] of items.entries()) {
		await client.query(
			`insert into issue_history_items
				(source_id, history_id, field, from_value, from_string, to_value,
				 to_string, sequence)
			 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				`${tag}:item:${randomUUID()}`,
				row.id,
				item.field,
				item.fromValue ?? null,
				item.fromString ?? null,
				item.toValue ?? null,
				item.toString ?? null,
				sequence,
			],
		);
	}
}

async function insertSprintReport(sprintId: string, contents: object) {
	await client.query(
		`insert into sprint_reports (sprint_id, rapid_view_id, contents)
		 values ($1, $2, $3)`,
		[sprintId, rapidViewId, JSON.stringify(contents)],
	);
}

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const owner = await makeUser(run, "owner", { admin: true });
	const first = await makeUser(run, "first", { admin: true });
	const second = await makeUser(run, "second", { admin: true });
	firstUserId = first.id;
	secondUserId = second.id;
	actor = asActor(owner);

	sameName = `Same Name ${run}`;
	await db
		.update(users)
		.set({ displayName: sameName })
		.where(inArray(users.id, [first.id, second.id]));

	// A stored story-point field name whose casing differs from the name the
	// application writes into its own history rows.
	await client.query("delete from fields where lower(name) = 'story points'");
	await client.query(
		`insert into fields (source_id, name, type, custom_key)
		 values ($1, 'story points', 'float', $2)`,
		[
			`${tag}:field:story-points`,
			"com.atlassian.jira.plugin.system.customfieldtypes:float",
		],
	);

	project = await createProjectFixture(client, {
		run,
		key: projectKey,
		issues: [
			{ summary: "Story points issue", storyPoints: 5 },
			{ summary: "Status issue" },
			{ summary: "Timeline issue" },
			{ summary: "Velocity one", status: "done", storyPoints: 8 },
			{ summary: "Velocity two", status: "done", storyPoints: 5 },
			{ summary: "Velocity three", status: "done", storyPoints: 3 },
			{ summary: "First assignee", assigneeId: first.id },
			{ summary: "Second assignee", assigneeId: second.id },
		],
	});
	for (const [index, id] of project.issueIds.entries()) {
		issueIds[String(index)] = id;
		issueKeys[String(index)] = project.issueKeys[index];
	}

	const board = await client.query<{ id: string }>(
		`insert into boards
			(rapid_view_id, source_id, name, type, filter_jql, project_id,
			 estimation_field, config_imported)
		 values ($1, $2, $3, 'scrum', $4, $5, 'story_points', true)
		 returning id`,
		[
			rapidViewId,
			`${tag}:board`,
			`Reports service ${run}`,
			`project = ${projectKey}`,
			project.projectId,
		],
	);
	boardId = board.rows[0].id;
	for (const [sequence, statusId] of Object.values(
		project.statusIds,
	).entries()) {
		const column = await client.query<{ id: string }>(
			`insert into board_columns (board_id, name, sequence)
			 values ($1, $2, $3) returning id`,
			[boardId, `Column ${sequence}`, sequence],
		);
		await client.query(
			`insert into board_column_statuses (column_id, status_id, sequence)
			 values ($1, $2, 0)`,
			[column.rows[0].id, statusId],
		);
	}

	storySprintId = await insertSprint({
		name: `Story sprint ${run}`,
		state: "active",
		startDate: "2026-02-02T09:00:00.000Z",
		endDate: "2026-02-13T17:00:00.000Z",
		completeDate: null,
		sequence: 0,
	});
	statusSprintId = await insertSprint({
		name: `Status sprint ${run}`,
		state: "active",
		startDate: "2026-03-02T09:00:00.000Z",
		endDate: "2026-03-13T17:00:00.000Z",
		completeDate: "2026-03-13T18:00:00.000Z",
		sequence: 1,
	});
	timelineSprintId = await insertSprint({
		name: `Timeline sprint ${run}`,
		state: "closed",
		startDate: null,
		endDate: "2026-04-10T09:00:00.000Z",
		completeDate: "2026-04-12T18:00:00.000Z",
		sequence: 2,
	});

	await addToSprint(issueIds["0"], storySprintId);
	await addToSprint(issueIds["1"], statusSprintId);
	await addToSprint(issueIds["2"], timelineSprintId);

	// The application writes "Story Points"; the stored field is "story points".
	await history(issueIds["0"], "2026-02-05T12:00:00.000Z", [
		{
			field: "Story Points",
			fromValue: "3",
			fromString: "3",
			toValue: "5",
			toString: "5",
		},
	]);

	// Two statuses share a name. The history row points at the done one.
	const doneReview = (
		await client.query<{ id: string }>(
			`insert into statuses (source_id, name, category)
			 values ($1, $2, 'done') returning id`,
			[`${tag}:status:review-done`, `Review ${run}`],
		)
	).rows[0];
	const newReview = (
		await client.query<{ id: string }>(
			`insert into statuses (source_id, name, category)
			 values ($1, $2, 'new') returning id`,
			[`${tag}:status:review-new`, `Review ${run}`],
		)
	).rows[0];
	const startStatus = (
		await client.query<{ id: string }>(
			`insert into statuses (source_id, name, category)
			 values ($1, $2, 'new') returning id`,
			[`${tag}:status:start`, `Start ${run}`],
		)
	).rows[0];
	await client.query("update issues set status_id = $1 where id = $2", [
		startStatus.id,
		issueIds["1"],
	]);
	await history(issueIds["1"], "2026-03-05T12:00:00.000Z", [
		{
			field: "status",
			fromValue: startStatus.id,
			fromString: `Start ${run}`,
			toValue: doneReview.id,
			toString: `Review ${run}`,
		},
	]);
	// The decoy is inserted last, so a name-keyed map keeps this row.
	expect(newReview.id).not.toBe(doneReview.id);

	const velocityIssues = ["3", "4", "5"];
	for (const [index, key] of velocityIssues.entries()) {
		const sprintId = await insertSprint({
			name: `Velocity sprint ${run} ${index + 1}`,
			state: "closed",
			startDate: `2026-0${5 + index}-01T09:00:00.000Z`,
			endDate: `2026-0${5 + index}-10T17:00:00.000Z`,
			completeDate: `2026-0${5 + index}-10T18:00:00.000Z`,
			sequence: 3 + index,
		});
		await addToSprint(issueIds[key], sprintId);
		await insertSprintReport(sprintId, {
			completedIssues: [{ key: issueKeys[key] }],
			issuesNotCompletedInCurrentSprint: [],
			puntedIssues: [],
			issuesCompletedInAnotherSprint: [],
			issueKeysAddedDuringSprint: {},
			allIssuesEstimateSum: { text: String((index + 1) * 10) },
			completedIssuesEstimateSum: { text: String((index + 1) * 8) },
			issuesNotCompletedEstimateSum: { text: "0" },
			completedIssuesInitialEstimateSum: { text: String((index + 1) * 10) },
		});
	}
});

afterAll(async () => {
	if (client) {
		await client.query("delete from boards where id = $1", [boardId]);
		await client.query("delete from sprint_reports where rapid_view_id = $1", [
			rapidViewId,
		]);
		await dropProjectFixture(client, run);
		await client.query("delete from fields where source_id = $1", [
			`${tag}:field:story-points`,
		]);
		await client.query("delete from statuses where source_id like $1", [
			`${tag}:%`,
		]);
		await client.end();
	}
	await cleanupTestData(run);
	await pool.end();
});

describe("sprint reports", () => {
	test("a story-point history row written by the app matches the stored field name", async () => {
		const result = await burndownReport(actor, rapidViewId, {
			sprintId: storySprintId,
		});
		const changes = result.eventRows.filter(
			(row) => row.eventType === "estimate-changed",
		);
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({
			issueKey: issueKeys["0"],
			increase: 2,
		});
	});

	test("a status change resolves by id when two statuses share a name", async () => {
		const result = await sprintReport(actor, rapidViewId, {
			sprintId: statusSprintId,
		});
		expect(result.completed.map((row) => row.issue.key)).toContain(
			issueKeys["1"],
		);
	});
});

describe("burndown window", () => {
	test("a sprint without a start date keeps the end date as its timeline start", async () => {
		const result = await burndownReport(actor, rapidViewId, {
			sprintId: timelineSprintId,
		});
		expect(result.points[0]?.at).toBe("2026-04-10T09:00:00.000Z");
		expect(result.points.at(-1)?.at).toBe("2026-04-12T18:00:00.000Z");
	});
});

describe("closed sprint snapshot", () => {
	test("keeps an issue the board filter no longer returns", async () => {
		const filterBoard = await client.query<{ id: string }>(
			`insert into boards
				(rapid_view_id, source_id, name, type, filter_jql, project_id,
				 estimation_field, config_imported)
			 values ($1, $2, $3, 'scrum', $4, $5, 'story_points', true)
			 returning id`,
			[
				rapidViewId + 2,
				`${tag}:board:snapshot`,
				`Snapshot filter ${run}`,
				`project = ${projectKey} AND status = "To Do"`,
				project.projectId,
			],
		);
		const filterBoardId = filterBoard.rows[0].id;
		try {
			const sprint = await client.query<{ id: string }>(
				`insert into sprints
					(source_id, board_id, name, state, start_date, end_date,
					 complete_date, sequence)
				 values ($1, $2, $3, 'closed', '2026-07-01T09:00:00.000Z',
					'2026-07-10T17:00:00.000Z', '2026-07-10T18:00:00.000Z', 0)
				 returning id`,
				[`${tag}:sprint:snapshot`, filterBoardId, `Snapshot ${run}`],
			);
			const sprintId = sprint.rows[0].id;
			await client.query(
				`insert into issue_sprints (issue_id, sprint_id, is_open)
				 values ($1, $2, false)`,
				[issueIds["5"], sprintId],
			);
			await client.query(
				`insert into sprint_reports (sprint_id, rapid_view_id, contents)
				 values ($1, $2, $3)`,
				[
					sprintId,
					rapidViewId + 2,
					JSON.stringify({
						completedIssues: [{ key: issueKeys["5"] }],
						issuesNotCompletedInCurrentSprint: [],
						puntedIssues: [],
						issuesCompletedInAnotherSprint: [],
						issueKeysAddedDuringSprint: {},
					}),
				],
			);
			const result = await sprintReport(actor, rapidViewId + 2, {
				sprintId,
			});
			expect(result.completed.map((row) => row.issue.key)).toContain(
				issueKeys["5"],
			);
		} finally {
			await client.query("delete from boards where id = $1", [filterBoardId]);
		}
	});
});

describe("velocity", () => {
	test("uses the stored sprint report sums for every closed sprint", async () => {
		const result = await velocityReport(actor, rapidViewId, {});
		expect(result.sprints.map((sprint) => sprint.name)).toEqual([
			`Velocity sprint ${run} 1`,
			`Velocity sprint ${run} 2`,
			`Velocity sprint ${run} 3`,
		]);
		expect(result.sprints.map((sprint) => sprint.commitment)).toEqual([
			10, 20, 30,
		]);
		expect(result.sprints.map((sprint) => sprint.completed)).toEqual([
			8, 16, 24,
		]);
	});
});

describe("cumulative flow", () => {
	test("validates the date range before loading the board", async () => {
		const invalidBoard = await client.query<{ id: string }>(
			`insert into boards
				(rapid_view_id, source_id, name, type, filter_jql, project_id,
				 estimation_field, config_imported)
			 values ($1, $2, $3, 'scrum', 'nonsense ===', $4, 'story_points', true)
			 returning id`,
			[
				rapidViewId + 1,
				`${tag}:board:invalid`,
				`Invalid filter ${run}`,
				project.projectId,
			],
		);
		try {
			await expect(
				cumulativeFlowReport(actor, rapidViewId + 1, {
					from: "2026-02-01",
					to: "2026-01-01",
				}),
			).rejects.toMatchObject({
				status: 400,
				message: "Invalid date range",
			});
		} finally {
			await client.query("delete from boards where id = $1", [
				invalidBoard.rows[0].id,
			]);
		}
	});

	test("filters by user id and keeps two people with the same display name apart", async () => {
		const all = await cumulativeFlowReport(actor, rapidViewId, {
			from: "2026-01-01",
			to: "2026-01-10",
		});
		expect(all.assignees).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: firstUserId, name: sameName }),
				expect.objectContaining({ id: secondUserId, name: sameName }),
			]),
		);
		expect(all.assignees).toHaveLength(2);

		const filtered = await cumulativeFlowReport(actor, rapidViewId, {
			from: "2026-01-01",
			to: "2026-01-10",
			assignee: firstUserId,
		});
		expect(filtered.total.every((value) => value === 1)).toBe(true);
	});

	test("an invalid date range is rejected with a 400", async () => {
		await expect(
			cumulativeFlowReport(actor, rapidViewId, {
				from: "2026-02-01",
				to: "2026-01-01",
			}),
		).rejects.toBeInstanceOf(HttpError);
	});
});
