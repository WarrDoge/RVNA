import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	importAgileLocal,
	parseSprintDescriptor,
} from "../src/importer/agile.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	boardColumnStatuses,
	boardColumns,
	boards,
	fields,
	issueSprints,
	issues,
	issueTypes,
	projects,
	projectWorkflows,
	sprints,
	statuses,
	workflowStatuses,
	workflows,
} from "../src/lib/server/schema.ts";
import { fixtureFieldIds } from "./fixtures/jira.ts";

const run = randomUUID().slice(0, 8);
const tag = `agile-import-${run}`;
const projectKey = `I${run.slice(0, 6).toUpperCase()}`;
const rapidViewId = 500 + Number.parseInt(run.slice(0, 2), 16);

let projectId: string;
let taskTypeId: string;
let issueIds: string[] = [];

const openSprint = `com.atlassian.greenhopper.service.sprint.Sprint@[activatedDate=2026-01-01T00:00:00.000Z,autoStartStop=false,completeDate=<null>,endDate=2026-01-15T00:00:00.000Z,goal=Fixture goal,id=9001,incompleteIssuesDestinationId=<null>,name=Fixture Sprint One,rapidViewId=${rapidViewId},sequence=1,startDate=2026-01-01T00:00:00.000Z,state=ACTIVE,synced=false]`;
const closedSprint = `com.atlassian.greenhopper.service.sprint.Sprint@[activatedDate=2025-12-01T00:00:00.000Z,autoStartStop=false,completeDate=2025-12-15T00:00:00.000Z,endDate=2025-12-15T00:00:00.000Z,goal=<null>,id=9002,incompleteIssuesDestinationId=<null>,name=Fixture Sprint Zero,rapidViewId=${rapidViewId},sequence=0,startDate=2025-12-01T00:00:00.000Z,state=CLOSED,synced=false]`;
const futureSprint = `com.atlassian.greenhopper.service.sprint.Sprint@[activatedDate=<null>,autoStartStop=false,completeDate=<null>,endDate=2026-02-01T00:00:00.000Z,goal=<null>,id=9003,incompleteIssuesDestinationId=<null>,name=Fixture Sprint Two,rapidViewId=${rapidViewId},sequence=2,startDate=2026-01-20T00:00:00.000Z,state=FUTURE,synced=false]`;

async function cleanup() {
	await db.delete(boards).where(eq(boards.sourceId, String(rapidViewId)));
	await db.delete(fields).where(eq(fields.sourceId, fixtureFieldIds.sprint));
	const existing = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.key, projectKey));
	for (const project of existing) {
		await pool.query("delete from issues where project_id = $1", [project.id]);
		await pool.query("delete from project_workflows where project_id = $1", [
			project.id,
		]);
		await pool.query("delete from project_issue_types where project_id = $1", [
			project.id,
		]);
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

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project`,
			key: projectKey,
			name: "Agile import fixture",
			projectType: "software",
		})
		.returning();
	projectId = project.id;

	const [task] = await db
		.insert(issueTypes)
		.values({ sourceId: `${tag}:type`, name: "Task" })
		.returning();
	taskTypeId = task.id;

	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}:todo`, name: "To Do", category: "new" },
			{
				sourceId: `${tag}:progress`,
				name: "In Progress",
				category: "indeterminate",
			},
			{ sourceId: `${tag}:done`, name: "Done", category: "done" },
		])
		.returning();
	const [workflow] = await db
		.insert(workflows)
		.values({ sourceId: `${tag}:workflow`, name: `${tag} workflow` })
		.returning();
	await db.insert(workflowStatuses).values(
		statusRows.map((status) => ({
			workflowId: workflow.id,
			statusId: status.id,
		})),
	);
	await db.insert(projectWorkflows).values({
		sourceId: `${tag}:project-workflow`,
		projectId,
		issueTypeId: null,
		workflowId: workflow.id,
	});
	await db.insert(fields).values({
		sourceId: fixtureFieldIds.sprint,
		name: "Sprint",
		type: "array",
		customKey: "com.pyxis.greenhopper.jira:gh-sprint",
	});

	const created = await db
		.insert(issues)
		.values([
			{
				sourceId: `${tag}:issue-1`,
				projectId,
				number: 1,
				key: `${projectKey}-1`,
				typeId: taskTypeId,
				statusId: statusRows[0].id,
				summary: "Fixture issue one",
				rank: "0|a",
				custom: { [fixtureFieldIds.sprint]: [openSprint] },
			},
			{
				sourceId: `${tag}:issue-2`,
				projectId,
				number: 2,
				key: `${projectKey}-2`,
				typeId: taskTypeId,
				statusId: statusRows[1].id,
				summary: "Fixture issue two",
				rank: "0|b",
				custom: {
					[fixtureFieldIds.sprint]: [closedSprint, openSprint],
				},
			},
			{
				sourceId: `${tag}:issue-3`,
				projectId,
				number: 3,
				key: `${projectKey}-3`,
				typeId: taskTypeId,
				statusId: statusRows[0].id,
				summary: "Fixture issue three",
				rank: "0|c",
				custom: {},
			},
			{
				sourceId: `${tag}:issue-4`,
				projectId,
				number: 4,
				key: `${projectKey}-4`,
				typeId: taskTypeId,
				statusId: statusRows[0].id,
				summary: "Fixture issue four",
				rank: "0|d",
				custom: { [fixtureFieldIds.sprint]: [futureSprint] },
			},
		])
		.returning();
	issueIds = created.map((row) => row.id);
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe("parseSprintDescriptor", () => {
	test("parses the Java toString kept in the Sprint field", () => {
		const sprint = parseSprintDescriptor(openSprint);
		expect(sprint).toMatchObject({
			sourceId: "9001",
			rapidViewId,
			name: "Fixture Sprint One",
			goal: "Fixture goal",
			state: "active",
			sequence: 1,
		});
		expect(sprint?.startDate?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
		expect(sprint?.completeDate).toBeNull();
	});

	test("parses closed and future states", () => {
		expect(parseSprintDescriptor(closedSprint)?.state).toBe("closed");
		expect(parseSprintDescriptor(futureSprint)?.state).toBe("future");
		expect(parseSprintDescriptor(futureSprint)?.startDate?.toISOString()).toBe(
			"2026-01-20T00:00:00.000Z",
		);
	});

	test("ignores descriptors without an id, name or known state", () => {
		expect(parseSprintDescriptor("not a sprint")).toBeNull();
		expect(
			parseSprintDescriptor(
				openSprint.replace("state=ACTIVE", "state=SOMETHING"),
			),
		).toBeNull();
		expect(
			parseSprintDescriptor(openSprint.replace("id=9001,", "")),
		).toBeNull();
	});

	test("keeps a goal that contains commas", () => {
		const sprint = parseSprintDescriptor(
			openSprint.replace("goal=Fixture goal", "goal=Ship it, then rest"),
		);
		expect(sprint?.goal).toBe("Ship it, then rest");
	});
});

type ImportDatabase = NonNullable<Parameters<typeof importAgileLocal>[0]>;

/** Fails the insert of one table, so an import can be interrupted midway. */
function databaseFailingOn(
	shouldFail: (table: unknown) => boolean,
): ImportDatabase {
	const wrap = (base: object): ImportDatabase =>
		new Proxy(base, {
			get(target, property) {
				if (property === "transaction") {
					return (callback: (tx: object) => unknown) =>
						Reflect.get(target, property).call(target, (tx: object) =>
							callback(wrap(tx)),
						);
				}
				if (property === "insert") {
					return (table: unknown) => {
						if (shouldFail(table)) throw new Error("injected insert failure");
						return Reflect.get(target, property).call(target, table);
					};
				}
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		}) as ImportDatabase;
	return wrap(db);
}

describe("importAgileLocal", () => {
	test("creates the board, sprints and memberships from issue data", async () => {
		const counts = await importAgileLocal(db);
		expect(counts.boards).toBeGreaterThanOrEqual(1);

		const [board] = await db
			.select()
			.from(boards)
			.where(eq(boards.sourceId, String(rapidViewId)));
		expect(board).toMatchObject({
			rapidViewId,
			name: "Agile import fixture sprint board",
			type: "scrum",
			filterJql: `project = "${projectKey}"`,
			configImported: false,
		});

		const columns = await db
			.select()
			.from(boardColumns)
			.where(eq(boardColumns.boardId, board.id));
		expect(columns.map((column) => column.name)).toEqual([
			"To Do",
			"In Progress",
			"Done",
		]);
		const mappings = await db
			.select({ statusId: boardColumnStatuses.statusId })
			.from(boardColumnStatuses)
			.where(
				eq(
					boardColumnStatuses.columnId,
					columns.find((column) => column.name === "To Do")?.id ?? "",
				),
			);
		expect(mappings.length).toBeGreaterThanOrEqual(1);

		const sprintRows = await db
			.select()
			.from(sprints)
			.where(eq(sprints.boardId, board.id));
		expect(sprintRows.map((sprint) => sprint.state).sort()).toEqual([
			"active",
			"closed",
			"future",
		]);
		expect(sprintRows.find((sprint) => sprint.sourceId === "9001")?.name).toBe(
			"Fixture Sprint One",
		);

		const memberships = await db
			.select()
			.from(issueSprints)
			.where(eq(issueSprints.issueId, issueIds[1]));
		expect(memberships).toHaveLength(2);
		expect(memberships.filter((row) => row.isOpen)).toHaveLength(1);
		expect(memberships.filter((row) => !row.isOpen)).toHaveLength(1);

		const open = await db
			.select()
			.from(issueSprints)
			.where(
				and(
					eq(issueSprints.issueId, issueIds[0]),
					eq(issueSprints.isOpen, true),
				),
			);
		expect(open).toHaveLength(1);
	});

	test("is idempotent", async () => {
		await importAgileLocal(db);
		await importAgileLocal(db);
		const boardRows = await db
			.select()
			.from(boards)
			.where(eq(boards.sourceId, String(rapidViewId)));
		expect(boardRows).toHaveLength(1);
		const sprintRows = await db
			.select()
			.from(sprints)
			.where(eq(sprints.boardId, boardRows[0].id));
		expect(sprintRows).toHaveLength(3);
		const memberships = await db
			.select()
			.from(issueSprints)
			.where(eq(issueSprints.issueId, issueIds[1]));
		expect(memberships).toHaveLength(2);
	});

	test("a failed import keeps the memberships it had before", async () => {
		await importAgileLocal(db);
		const [board] = await db
			.select()
			.from(boards)
			.where(eq(boards.sourceId, String(rapidViewId)));
		const [stale] = await db
			.insert(sprints)
			.values({
				sourceId: `${tag}:stale-sprint`,
				boardId: board.id,
				name: "Stale sprint",
				state: "future",
			})
			.returning();
		await db.insert(issueSprints).values({
			issueId: issueIds[0],
			sprintId: stale.id,
			isOpen: false,
		});

		const database = databaseFailingOn((table) => table === issueSprints);
		await expect(importAgileLocal(database)).rejects.toThrow(
			"injected insert failure",
		);

		const kept = await db
			.select()
			.from(issueSprints)
			.where(
				and(
					eq(issueSprints.issueId, issueIds[0]),
					eq(issueSprints.sprintId, stale.id),
				),
			);
		expect(kept).toHaveLength(1);
	});

	test("a cleared or malformed sprint field drops the old membership", async () => {
		await importAgileLocal(db);
		const [sprintRow] = await db
			.select()
			.from(sprints)
			.where(eq(sprints.sourceId, "9001"));
		const membershipCount = async () =>
			(
				await db
					.select()
					.from(issueSprints)
					.where(
						and(
							eq(issueSprints.issueId, issueIds[0]),
							eq(issueSprints.sprintId, sprintRow.id),
						),
					)
			).length;
		expect(await membershipCount()).toBe(1);

		await db
			.update(issues)
			.set({ custom: { [fixtureFieldIds.sprint]: ["not a sprint"] } })
			.where(eq(issues.id, issueIds[0]));
		await importAgileLocal(db);
		expect(await membershipCount()).toBe(0);
	});

	test("does not overwrite a board whose real configuration was imported", async () => {
		const [board] = await db
			.select()
			.from(boards)
			.where(eq(boards.sourceId, String(rapidViewId)));
		await db
			.update(boards)
			.set({ name: "Real board name", configImported: true })
			.where(eq(boards.id, board.id));

		await importAgileLocal(db);

		const [after] = await db
			.select()
			.from(boards)
			.where(eq(boards.id, board.id));
		expect(after.name).toBe("Real board name");
		expect(after.configImported).toBe(true);
	});
});
