import { eq, inArray } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	createSprint,
	deleteSprint,
	getBacklog,
	listBoards,
	moveIssues,
	startSprint,
	updateSprint,
} from "../src/lib/server/agile/service.ts";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	boards,
	issueFixVersions,
	issues,
	issueTypes,
	projectIssueTypes,
	sprints,
	versions,
} from "../src/lib/server/schema.ts";
import { load as loadPlan } from "../src/routes/boards/[rapidViewId]/plan/+page.server.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
} from "./fixtures/project.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const visibleKey = fixtureKey(run);
const otherKey = `OB${run.slice(0, 5).toUpperCase()}`;
const hiddenKey = `HB${run.slice(0, 5).toUpperCase()}`;
const otherRun = `${run}ot`;
const hiddenRun = `${run}hi`;
const hiddenScheme = `test:${run}:backlog-hidden-scheme`;

let client: Client;
let owner: CurrentUser;
let outsider: CurrentUser;
let visibleProjectId: string;
let visibleStatusId: string;
let visibleIssueKeys: string[];
let otherProjectId: string;
let otherStatusId: string;
let otherIssueKey: string;
let hiddenProjectId: string;
let hiddenRapidViewId: number;
const boardIds: string[] = [];

function actorOf(user: { id: string; username: string }): CurrentUser {
	return {
		id: user.id,
		username: user.username,
		displayName: `Test backlog ${user.username}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};
}

function nextRapidViewId() {
	return 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
}

async function createBoard(input: {
	name: string;
	filterJql: string;
	projectId: string | null;
	ownerId: string;
}) {
	const [board] = await db
		.insert(boards)
		.values({
			rapidViewId: nextRapidViewId(),
			name: input.name,
			type: "scrum",
			filterJql: input.filterJql,
			projectId: input.projectId,
			ownerId: input.ownerId,
		})
		.returning();
	boardIds.push(board.id);
	return board;
}

async function createFutureSprint(
	boardId: string,
	name: string,
	sequence: number,
) {
	const [sprint] = await db
		.insert(sprints)
		.values({ boardId, name, state: "future", sequence })
		.returning();
	return sprint;
}

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const ownerUser = await makeUser(run, "backlog-owner");
	owner = actorOf(ownerUser);
	const outsiderUser = await makeUser(run, "backlog-outsider");
	outsider = actorOf(outsiderUser);

	const visible = await createProjectFixture(client, {
		run,
		key: visibleKey,
		name: `Backlog visible ${run}`,
		members: [owner.username],
		issues: [
			{ summary: `Backlog visible one ${run}` },
			{ summary: `Backlog visible two ${run}` },
			{ summary: `Backlog visible three ${run}` },
		],
	});
	visibleProjectId = visible.projectId;
	visibleStatusId = visible.statusIds.todo;
	visibleIssueKeys = visible.issueKeys;

	const other = await createProjectFixture(client, {
		run: otherRun,
		key: otherKey,
		name: `Backlog other ${run}`,
		members: [owner.username],
		issues: [{ summary: `Backlog other issue ${run}` }],
	});
	otherProjectId = other.projectId;
	otherStatusId = other.statusIds.todo;
	otherIssueKey = other.issueKeys[0] as string;

	const hidden = await createProjectFixture(client, {
		run: hiddenRun,
		key: hiddenKey,
		name: `Backlog hidden ${run}`,
		issues: [{ summary: `Backlog hidden issue ${run}` }],
	});
	hiddenProjectId = hidden.projectId;
	await client.query(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb)`,
		[
			hiddenScheme,
			`Backlog hidden scheme ${run}`,
			JSON.stringify([hiddenProjectId]),
		],
	);

	const hiddenBoard = await createBoard({
		name: `Hidden filter board ${run}`,
		filterJql: `project = ${hiddenKey}`,
		projectId: null,
		ownerId: owner.id,
	});
	hiddenRapidViewId = hiddenBoard.rapidViewId;

	await createBoard({
		name: `Visible filter board ${run}`,
		filterJql: `project = ${visibleKey}`,
		projectId: null,
		ownerId: owner.id,
	});
});

afterAll(async () => {
	if (boardIds.length > 0) {
		await db.delete(boards).where(inArray(boards.id, boardIds));
	}
	if (client) {
		await client.query("delete from permission_schemes where source_id = $1", [
			hiddenScheme,
		]);
		await dropProjectFixture(client, run);
		await dropProjectFixture(client, otherRun);
		await dropProjectFixture(client, hiddenRun);
		await client.end();
	}
	await cleanupTestData(run);
	await pool.end();
});

describe("project-less board access", () => {
	test("is limited to the owner or a visible project in the filter", async () => {
		await expect(
			getBacklog(outsider, hiddenRapidViewId, {}),
		).rejects.toMatchObject({ status: 404 });

		const outsiderBoards = await listBoards(outsider);
		expect(
			outsiderBoards.some((board) => board.rapidViewId === hiddenRapidViewId),
		).toBe(false);

		const ownerBoards = await listBoards(owner);
		expect(
			ownerBoards.some((board) => board.rapidViewId === hiddenRapidViewId),
		).toBe(true);
		await expect(
			getBacklog(owner, hiddenRapidViewId, {}),
		).resolves.toBeTruthy();

		const visibleBoard = ownerBoards.find(
			(board) => board.name === `Visible filter board ${run}`,
		);
		if (!visibleBoard) throw new Error("visible board was not created");
		await expect(
			getBacklog(outsider, visibleBoard.rapidViewId, {}),
		).resolves.toBeTruthy();
	});

	test("the plan load does not serialize board JQL", async () => {
		const result = await loadPlan({
			locals: { user: owner },
			url: new URL(`http://localhost/boards/${hiddenRapidViewId}/plan`),
			params: { rapidViewId: String(hiddenRapidViewId) },
			depends: () => undefined,
			route: { id: "/boards/[rapidViewId]/plan" },
		} as never);
		if (result.missing) throw new Error("plan load returned missing");
		expect(result.backlog.board).not.toHaveProperty("filterJql");
		expect(result.backlog.board).not.toHaveProperty("subFilterJql");
		expect(result.backlog.board).not.toHaveProperty("swimlanes");
		expect(
			result.backlog.board.quickFilters.every((filter) => !("jql" in filter)),
		).toBe(true);
		expect(
			result.backlog.quickFilters.every((filter) => !("jql" in filter)),
		).toBe(true);
		expect(result.sidebar.project.key).toBe("");
		expect(result.sidebar.boards[0]).not.toHaveProperty("filterJql");
	});
});

describe("sprint writes", () => {
	test("refuse an archived project", async () => {
		const board = await createBoard({
			name: `Archived sprint board ${run}`,
			filterJql: `project = ${visibleKey}`,
			projectId: visibleProjectId,
			ownerId: owner.id,
		});
		const sprint = await createFutureSprint(
			board.id,
			`Archived sprint ${run}`,
			1,
		);
		await client.query("update projects set archived = true where id = $1", [
			visibleProjectId,
		]);
		const start = {
			startDate: new Date().toISOString(),
			endDate: new Date(Date.now() + 86_400_000).toISOString(),
		};
		try {
			await expect(
				createSprint(owner, board.rapidViewId, { name: "New sprint" }),
			).rejects.toMatchObject({ status: 403 });
			await expect(
				updateSprint(owner, sprint.id, { name: "Renamed sprint" }),
			).rejects.toMatchObject({ status: 403 });
			await expect(startSprint(owner, sprint.id, start)).rejects.toMatchObject({
				status: 403,
			});
			await expect(deleteSprint(owner, sprint.id)).rejects.toMatchObject({
				status: 403,
			});
		} finally {
			await client.query("update projects set archived = false where id = $1", [
				visibleProjectId,
			]);
		}
	});

	test("startSprint renames and starts in one transaction", async () => {
		const board = await createBoard({
			name: `Rename sprint board ${run}`,
			filterJql: `project = ${visibleKey}`,
			projectId: visibleProjectId,
			ownerId: owner.id,
		});
		const sprint = await createFutureSprint(board.id, `Old name ${run}`, 1);
		const started = await startSprint(owner, sprint.id, {
			name: `New name ${run}`,
			startDate: new Date().toISOString(),
			endDate: new Date(Date.now() + 86_400_000).toISOString(),
		});
		expect(started.name).toBe(`New name ${run}`);
		expect(started.state).toBe("active");
	});

	test("two simultaneous starts leave one active sprint", async () => {
		const board = await createBoard({
			name: `Concurrent start board ${run}`,
			filterJql: `project = ${visibleKey}`,
			projectId: visibleProjectId,
			ownerId: owner.id,
		});
		const first = await createFutureSprint(board.id, `Start one ${run}`, 1);
		const second = await createFutureSprint(board.id, `Start two ${run}`, 2);
		const body = {
			startDate: new Date().toISOString(),
			endDate: new Date(Date.now() + 86_400_000).toISOString(),
		};
		const results = await Promise.allSettled([
			startSprint(owner, first.id, body),
			startSprint(owner, second.id, body),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const rows = await db
			.select({ state: sprints.state })
			.from(sprints)
			.where(eq(sprints.boardId, board.id));
		expect(rows).toHaveLength(2);
		expect(rows.filter((row) => row.state === "active")).toHaveLength(1);
	});
});

describe("rank writes", () => {
	test("simultaneous moves to one position keep ranks unique", async () => {
		const board = await createBoard({
			name: `Rank board ${run}`,
			filterJql: `project = ${visibleKey}`,
			projectId: visibleProjectId,
			ownerId: owner.id,
		});
		const target = visibleIssueKeys[0] as string;
		const moving = visibleIssueKeys.slice(1);
		const results = await Promise.allSettled(
			moving.map((key) =>
				moveIssues(owner, board.rapidViewId, {
					issues: [key],
					sprintId: null,
					before: target,
				}),
			),
		);
		expect(results.every((result) => result.status === "fulfilled")).toBe(true);
		const rows = await db
			.select({ rank: issues.rank })
			.from(issues)
			.where(inArray(issues.key, [...visibleIssueKeys]));
		expect(new Set(rows.map((row) => row.rank)).size).toBe(rows.length);
	});
});

describe("backlog facets", () => {
	test("epics and versions stay visible while the list is filtered", async () => {
		const board = await createBoard({
			name: `Facet board ${run}`,
			filterJql: `project in (${visibleKey}, ${otherKey})`,
			projectId: visibleProjectId,
			ownerId: owner.id,
		});
		const [epicType] = await db
			.insert(issueTypes)
			.values({ sourceId: `test:${run}:epic`, name: "Epic" })
			.returning();
		await db.insert(projectIssueTypes).values([
			{
				sourceId: `test:${run}:visible-epic-type`,
				projectId: visibleProjectId,
				issueTypeId: epicType.id,
			},
			{
				sourceId: `test:${run}:other-epic-type`,
				projectId: otherProjectId,
				issueTypeId: epicType.id,
			},
		]);
		const [visibleEpic] = await db
			.insert(issues)
			.values({
				sourceId: `test:${run}:visible-epic`,
				projectId: visibleProjectId,
				number: 101,
				key: `${visibleKey}-101`,
				typeId: epicType.id,
				statusId: visibleStatusId,
				summary: `Visible epic ${run}`,
				rank: "0|epic-a",
			})
			.returning();
		const [otherEpic] = await db
			.insert(issues)
			.values({
				sourceId: `test:${run}:other-epic`,
				projectId: otherProjectId,
				number: 101,
				key: `${otherKey}-101`,
				typeId: epicType.id,
				statusId: otherStatusId,
				summary: `Other epic ${run}`,
				rank: "0|epic-b",
			})
			.returning();
		const [visibleVersion] = await db
			.insert(versions)
			.values({
				sourceId: `test:${run}:version-a`,
				projectId: visibleProjectId,
				name: `Visible version ${run}`,
			})
			.returning();
		const [otherVersion] = await db
			.insert(versions)
			.values({
				sourceId: `test:${run}:version-b`,
				projectId: otherProjectId,
				name: `Other version ${run}`,
			})
			.returning();
		await db.insert(issueFixVersions).values([
			{
				sourceId: `test:${run}:fix-a`,
				issueId: visibleEpic.id,
				versionId: visibleVersion.id,
			},
			{
				sourceId: `test:${run}:fix-b`,
				issueId: otherEpic.id,
				versionId: otherVersion.id,
			},
		]);
		await db
			.update(issues)
			.set({ epicId: visibleEpic.id })
			.where(eq(issues.key, visibleIssueKeys[0] as string));
		await db
			.update(issues)
			.set({ epicId: otherEpic.id })
			.where(eq(issues.key, otherIssueKey));

		const backlog = await getBacklog(owner, board.rapidViewId, {
			epic: visibleEpic.key,
		});
		expect(backlog.epics.map((epic) => epic.key)).toEqual(
			expect.arrayContaining([visibleEpic.key, otherEpic.key]),
		);
		expect(backlog.versions.map((version) => version.id)).toEqual(
			expect.arrayContaining([visibleVersion.id, otherVersion.id]),
		);
	});
});
