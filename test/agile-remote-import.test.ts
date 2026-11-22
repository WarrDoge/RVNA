import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	fetchSprintReport,
	filterProjectKeys,
	importJiraAgile,
	issueRank,
	type JiraAgileBoard,
	type JiraAgileIssue,
	type JiraBoardConfiguration,
	type JiraEditModel,
	type JiraFilter,
	type JiraSprint,
	type JiraSprintReport,
	mapSprint,
	parseBoardConfig,
	projectKeysFromJql,
} from "../src/importer/agile-remote.ts";
import type { JiraClient } from "../src/importer/jira.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	boardColumnStatuses,
	boardColumns,
	boardQuickFilters,
	boardSprints,
	boardSwimlanes,
	boards,
	issueSprints,
	issues,
	issueTypes,
	projects,
	sprintReports,
	sprints,
	statuses,
	users,
} from "../src/lib/server/schema.ts";
import { fixtureFieldIds } from "./fixtures/jira.ts";

const run = randomUUID().slice(0, 8);
const tag = `agile-remote-${run}`;
const projectKey = `R${run.slice(0, 6).toUpperCase()}`;
const rapidViewId = 880000 + Number.parseInt(run.slice(0, 4), 16);
const secondRapidViewId = rapidViewId + 1;
const sprintId = 770000 + Number.parseInt(run.slice(0, 3), 16);
const ownerName = `t-${tag}-owner`;
const issueKeys = [`${projectKey}-1`, `${projectKey}-2`];
const statusIds = ["new", "progress", "done"].map((name) => `${tag}-${name}`);

let projectId: string;
let typeId: string;
let dbStatusIds: string[];
let issueIds: string[];

const board: JiraAgileBoard = {
	id: rapidViewId,
	name: "Fixture remote board",
	type: "scrum",
};

const configuration: JiraBoardConfiguration = {
	id: rapidViewId,
	name: "Fixture remote board",
	type: "scrum",
	filter: { id: "9001" },
	columnConfig: {
		columns: [
			{ name: "To Do", statuses: [{ id: statusIds[0] }] },
			{ name: "Doing", statuses: [{ id: statusIds[1] }] },
			{ name: "Done", statuses: [{ id: statusIds[2] }] },
		],
	},
	estimation: {
		type: "field",
		field: {
			fieldId: fixtureFieldIds.storyPoints,
			displayName: "Story Points",
		},
	},
	ranking: { rankCustomFieldId: 10108 },
};

const editModel: JiraEditModel = {
	id: rapidViewId,
	name: "Fixture remote board",
	rapidListConfig: {
		mappedColumns: [
			{
				name: "Backlog",
				min: "",
				max: "",
				mappedStatuses: [],
				isKanPlanColumn: true,
			},
			{
				name: "To Do",
				min: "2",
				max: "5",
				mappedStatuses: [{ id: statusIds[0] }],
			},
			{
				name: "Doing",
				min: "",
				max: "3",
				mappedStatuses: [{ id: statusIds[1] }],
			},
			{
				name: "Done",
				min: "",
				max: "",
				mappedStatuses: [{ id: statusIds[2] }],
			},
		],
	},
	swimlanesConfig: {
		swimlaneStrategy: "custom",
		swimlanes: [
			{
				id: 1,
				name: "Expedite",
				query: "priority = Highest",
				isDefault: false,
			},
			{ id: 2, name: "Everything Else", query: "", isDefault: true },
		],
	},
	quickFilterConfig: {
		quickFilters: [
			{ id: 1, name: "Only mine", query: "assignee = currentUser()" },
			{ id: 2, name: "Recent", query: "updatedDate >= -1d" },
		],
	},
	subqueryConfig: {
		subqueries: [{ id: 1, query: "fixVersion is EMPTY" }],
	},
	estimationStatisticConfig: {
		currentEstimationStatistic: {
			typeId: "field",
			fieldId: fixtureFieldIds.storyPoints,
			name: "Story Points",
		},
	},
	cardColorConfig: { cardColorStrategy: "priority" },
	workingDaysConfig: { nonWorkingDays: [] },
};

const filter: JiraFilter = {
	id: "9001",
	name: "Fixture filter",
	jql: `project = "${projectKey}" ORDER BY Rank ASC`,
	owner: { name: ownerName, displayName: "Fixture Owner" },
	queryProjects: { projects: [{ key: projectKey }] },
};

const jiraSprint: JiraSprint = {
	id: sprintId,
	state: "closed",
	name: "Fixture Sprint 1",
	goal: "Ship the fixture",
	startDate: "2026-03-02T09:00:00.000Z",
	endDate: "2026-03-13T18:00:00.000Z",
	completeDate: "2026-03-13T19:00:00.000Z",
	originBoardId: rapidViewId,
};

const issue = (
	key: string,
	rank: string,
	statusId: string,
): JiraAgileIssue => ({
	id: `${tag}-${key}`,
	key,
	fields: {
		[fixtureFieldIds.rank]: rank,
		status: { id: statusId },
	},
});

const jiraFields = [
	{
		id: fixtureFieldIds.storyPoints,
		name: "Story Points",
		custom: true,
		schema: {
			type: "number",
			custom: "com.atlassian.jira.plugin.system.customfieldtypes:float",
		},
	},
	{
		id: fixtureFieldIds.sprint,
		name: "Sprint",
		custom: true,
		schema: {
			type: "array",
			custom: "com.pyxis.greenhopper.jira:gh-sprint",
		},
	},
	{
		id: fixtureFieldIds.epicLink,
		name: "Epic Link",
		custom: true,
		schema: {
			type: "any",
			custom: "com.pyxis.greenhopper.jira:gh-epic-link",
		},
	},
	{
		id: fixtureFieldIds.rank,
		name: "Rank",
		custom: true,
		schema: {
			type: "string",
			custom: "com.pyxis.greenhopper.jira:gh-lexo-rank",
		},
	},
];

const sprintReport: JiraSprintReport = {
	contents: {
		completedIssues: [{ key: issueKeys[0] }],
		issuesNotCompletedInCurrentSprint: [{ key: issueKeys[1] }],
		puntedIssues: [],
		issuesCompletedInAnotherSprint: [],
		issueKeysAddedDuringSprint: { [issueKeys[1]]: true },
		completedIssuesInitialEstimateSum: { text: "5.0" },
		completedIssuesEstimateSum: { text: "5.0" },
		issuesNotCompletedInitialEstimateSum: { text: "3.0" },
		issuesNotCompletedEstimateSum: { text: "3.0" },
		allIssuesEstimateSum: { text: "8.0" },
	},
};

class FakeClient {
	readonly calls: string[] = [];
	private readonly sprints: JiraSprint[];
	private readonly sprintIssues: Map<number, JiraAgileIssue[]>;

	constructor(
		sprints: JiraSprint[] = [jiraSprint],
		sprintIssues: Map<number, JiraAgileIssue[]> = new Map([
			[
				sprintId,
				[
					issue(issueKeys[0], "0|a", statusIds[2]),
					issue(issueKeys[1], "0|b", statusIds[0]),
				],
			],
		]),
	) {
		this.sprints = sprints;
		this.sprintIssues = sprintIssues;
	}

	async getJson(path: string): Promise<unknown> {
		this.calls.push(path);
		if (path === "/rest/agile/1.0/board") {
			return { values: [board], isLast: true };
		}
		if (path === `/rest/agile/1.0/board/${rapidViewId}/configuration`) {
			return configuration;
		}
		if (path === "/rest/api/2/field") {
			return jiraFields;
		}
		if (path === "/rest/greenhopper/1.0/rapidviewconfig/editmodel.json") {
			return editModel;
		}
		if (path === "/rest/api/2/filter/9001") {
			return filter;
		}
		if (path === `/rest/agile/1.0/board/${rapidViewId}/sprint`) {
			return { values: this.sprints, isLast: true };
		}
		if (path === `/rest/agile/1.0/board/${rapidViewId}/issue`) {
			return {
				issues: [
					issue(issueKeys[0], "0|a", statusIds[2]),
					issue(issueKeys[1], "0|b", statusIds[0]),
				],
				isLast: true,
			};
		}
		if (path.startsWith("/rest/agile/1.0/sprint/") && path.endsWith("/issue")) {
			const id = Number(path.split("/")[5]);
			return { issues: this.sprintIssues.get(id) ?? [], isLast: true };
		}
		if (path === "/rest/greenhopper/1.0/rapid/charts/sprintreport") {
			return sprintReport;
		}
		throw new Error(`Unexpected fixture path ${path}`);
	}
}

type ImportDatabase = NonNullable<Parameters<typeof importJiraAgile>[1]>;

/** Fails the insert of one table, so a replacement can be interrupted midway. */
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

async function cleanup() {
	await db
		.delete(boards)
		.where(
			inArray(boards.sourceId, [
				String(rapidViewId),
				String(secondRapidViewId),
			]),
		);
	await db.delete(projects).where(eq(projects.key, projectKey));
	await db.delete(users).where(eq(users.username, ownerName));
	await db.delete(statuses).where(eq(statuses.sourceId, `${tag}-new`));
	await db.delete(statuses).where(eq(statuses.sourceId, `${tag}-progress`));
	await db.delete(statuses).where(eq(statuses.sourceId, `${tag}-done`));
	await db.delete(issueTypes).where(eq(issueTypes.sourceId, `${tag}-type`));
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project`,
			key: projectKey,
			name: "Fixture remote project",
			projectType: "software",
		})
		.returning();
	projectId = project.id;
	const [type] = await db
		.insert(issueTypes)
		.values({ sourceId: `${tag}-type`, name: "Task" })
		.returning();
	typeId = type.id;
	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}-new`, name: "To Do", category: "new" },
			{
				sourceId: `${tag}-progress`,
				name: "In Progress",
				category: "indeterminate",
			},
			{ sourceId: `${tag}-done`, name: "Done", category: "done" },
		])
		.returning();
	dbStatusIds = statusRows.map((row) => row.id);
	await db
		.insert(users)
		.values({
			username: ownerName,
			displayName: "Fixture Owner",
			sourceKey: `${tag}-owner`,
		})
		.onConflictDoNothing();
	const created = await db
		.insert(issues)
		.values([
			{
				sourceId: `${tag}:issue-1`,
				projectId,
				number: 1,
				key: issueKeys[0],
				typeId,
				statusId: dbStatusIds[2],
				summary: "Fixture issue one",
				storyPoints: 5,
			},
			{
				sourceId: `${tag}:issue-2`,
				projectId,
				number: 2,
				key: issueKeys[1],
				typeId,
				statusId: dbStatusIds[0],
				summary: "Fixture issue two",
				storyPoints: 3,
			},
		])
		.returning();
	issueIds = created.map((row) => row.id);
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe("Jira agile mapping", () => {
	test("maps the two board configuration payloads", () => {
		const plan = parseBoardConfig(
			configuration,
			editModel,
			fixtureFieldIds.storyPoints,
		);
		expect(plan.columns.map((column) => column.name)).toEqual([
			"Backlog",
			"To Do",
			"Doing",
			"Done",
		]);
		expect(plan.columns[1]).toMatchObject({
			minIssues: 2,
			maxIssues: 5,
			statusSourceIds: [statusIds[0]],
		});
		expect(plan.columns[0].kanbanBacklog).toBe(true);
		expect(plan.kanbanBacklogStatusSourceId).toBeNull();
		expect(plan.swimlanes).toEqual([
			{ name: "Expedite", jql: "priority = Highest", sequence: 0 },
		]);
		expect(plan.quickFilters.map((item) => item.name)).toEqual([
			"Only mine",
			"Recent",
		]);
		expect(plan.subFilterJql).toBe("fixVersion is EMPTY");
		expect(plan.estimationField).toBe("story_points");
		expect(plan.swimlaneStrategy).toBe("queries");
		expect(plan.cardColourStrategy).toBe("priority");
		expect(plan.rankCustomFieldId).toBe(10108);
	});

	test("maps sprint fields and parses filter project keys", () => {
		const mapped = mapSprint(jiraSprint, rapidViewId, 4);
		expect(mapped).toMatchObject({
			sourceId: String(sprintId),
			boardId: rapidViewId,
			name: "Fixture Sprint 1",
			goal: "Ship the fixture",
			state: "closed",
			sequence: 4,
		});
		expect(mapped.completeDate?.toISOString()).toBe("2026-03-13T19:00:00.000Z");
		expect(mapSprint({ ...jiraSprint, goal: "" }, rapidViewId, 0).goal).toBe(
			null,
		);
		expect(projectKeysFromJql(`project IN (${projectKey}, "OTHER")`)).toEqual([
			projectKey,
			"OTHER",
		]);
		expect(filterProjectKeys(filter)).toContain(projectKey);
	});

	test("reads an unquoted project key from the filter JQL", () => {
		expect(projectKeysFromJql(`project = ${projectKey}`)).toEqual([projectKey]);
		expect(
			filterProjectKeys({
				id: "1",
				name: "Fixture filter",
				jql: `project = ${projectKey}`,
			}),
		).toEqual([projectKey]);
	});

	test("reads the rank field and tolerates a missing rank", () => {
		const ranked = issue(issueKeys[0], "0|a", statusIds[0]);
		expect(issueRank(ranked, fixtureFieldIds.rank)).toBe("0|a");
		expect(
			issueRank({ ...ranked, fields: {} }, fixtureFieldIds.rank),
		).toBeNull();
	});

	test("returns null for a sprint report Jira cannot serve", async () => {
		const client = {
			getJson: async () => {
				throw Object.assign(new Error("not found"), { status: 404 });
			},
		} as unknown as JiraClient;
		await expect(fetchSprintReport(client, 1, 2)).resolves.toBeNull();
	});
});

describe("importJiraAgile", () => {
	test("writes the real configuration and is idempotent", async () => {
		const client = new FakeClient();
		const first = await importJiraAgile(client as unknown as JiraClient, db, {
			privateApis: true,
		});
		expect(first.boards).toBe(1);
		expect(first.sprints.closed).toBe(1);
		expect(first.issueSprints).toBe(2);

		const [boardRow] = await db
			.select()
			.from(boards)
			.where(eq(boards.sourceId, String(rapidViewId)));
		expect(boardRow).toMatchObject({
			rapidViewId,
			name: "Fixture remote board",
			type: "scrum",
			filterJql: `project = "${projectKey}" ORDER BY Rank ASC`,
			estimationField: "story_points",
			swimlaneStrategy: "queries",
			cardColourStrategy: "priority",
			subFilterJql: "fixVersion is EMPTY",
			configImported: true,
		});
		expect(boardRow.ownerId).toBeTruthy();
		expect(boardRow.projectId).toBe(projectId);

		const columnRows = await db
			.select()
			.from(boardColumns)
			.where(eq(boardColumns.boardId, boardRow.id))
			.orderBy(boardColumns.sequence);
		expect(columnRows.map((column) => column.name)).toEqual([
			"Backlog",
			"To Do",
			"Doing",
			"Done",
		]);
		expect(columnRows[1]).toMatchObject({ minIssues: 2, maxIssues: 5 });
		const mappings = await db
			.select()
			.from(boardColumnStatuses)
			.where(eq(boardColumnStatuses.columnId, columnRows[1].id));
		expect(mappings.map((row) => row.statusId)).toEqual([dbStatusIds[0]]);

		const swimlaneRows = await db
			.select()
			.from(boardSwimlanes)
			.where(eq(boardSwimlanes.boardId, boardRow.id));
		expect(swimlaneRows.map((row) => row.name)).toEqual(["Expedite"]);
		const quickFilterRows = await db
			.select()
			.from(boardQuickFilters)
			.where(eq(boardQuickFilters.boardId, boardRow.id));
		expect(quickFilterRows.map((row) => row.name)).toEqual([
			"Only mine",
			"Recent",
		]);

		const [sprintRow] = await db
			.select()
			.from(sprints)
			.where(eq(sprints.sourceId, String(sprintId)));
		expect(sprintRow).toMatchObject({
			boardId: boardRow.id,
			name: "Fixture Sprint 1",
			state: "closed",
			goal: "Ship the fixture",
			sequence: 0,
		});
		const associations = await db
			.select()
			.from(boardSprints)
			.where(eq(boardSprints.boardId, boardRow.id));
		expect(associations.map((row) => row.sprintId)).toEqual([sprintRow.id]);

		const memberships = await db
			.select()
			.from(issueSprints)
			.where(eq(issueSprints.sprintId, sprintRow.id));
		expect(memberships).toHaveLength(2);
		expect(memberships.every((row) => !row.isOpen)).toBe(true);

		const [reportRow] = await db
			.select()
			.from(sprintReports)
			.where(eq(sprintReports.sprintId, sprintRow.id));
		expect(reportRow.rapidViewId).toBe(rapidViewId);
		expect(reportRow.contents).toMatchObject({
			completedIssues: [{ key: issueKeys[0] }],
		});

		const ranked = await db
			.select()
			.from(issues)
			.where(eq(issues.projectId, projectId));
		expect(ranked.find((row) => row.key === issueKeys[0])?.rank).toBe("0|a");
		expect(ranked.find((row) => row.key === issueKeys[1])?.rank).toBe("0|b");

		const second = await importJiraAgile(client as unknown as JiraClient, db, {
			privateApis: true,
		});
		for (const [table, counts] of Object.entries(second.counts)) {
			expect(counts.inserted, `${table} inserted`).toBe(0);
			expect(counts.updated, `${table} updated`).toBe(0);
		}
		expect(second.boards).toBe(1);
		expect(second.issueSprints).toBe(2);

		const after = await db
			.select()
			.from(boards)
			.where(eq(boards.id, boardRow.id));
		expect(after).toHaveLength(1);
		expect(after[0].name).toBe(boardRow.name);
		expect(issueIds).toHaveLength(2);
	});

	test("a failed board configuration rebuild keeps the previous columns", async () => {
		await importJiraAgile(new FakeClient() as unknown as JiraClient, db, {
			privateApis: true,
		});
		const [boardRow] = await db
			.select()
			.from(boards)
			.where(eq(boards.sourceId, String(rapidViewId)));
		const before = await db
			.select()
			.from(boardColumns)
			.where(eq(boardColumns.boardId, boardRow.id))
			.orderBy(boardColumns.sequence);
		expect(before).toHaveLength(4);

		class TwoColumnClient extends FakeClient {
			override async getJson(path: string): Promise<unknown> {
				if (path === "/rest/greenhopper/1.0/rapidviewconfig/editmodel.json") {
					return {
						...editModel,
						rapidListConfig: {
							mappedColumns: (
								editModel.rapidListConfig?.mappedColumns ?? []
							).slice(0, 2),
						},
					};
				}
				return super.getJson(path);
			}
		}

		const database = databaseFailingOn(
			(table) => table === boardColumnStatuses,
		);
		await expect(
			importJiraAgile(
				new TwoColumnClient() as unknown as JiraClient,
				database,
				{
					privateApis: true,
				},
			),
		).rejects.toThrow("injected insert failure");

		const after = await db
			.select()
			.from(boardColumns)
			.where(eq(boardColumns.boardId, boardRow.id))
			.orderBy(boardColumns.sequence);
		expect(after.map((column) => column.name)).toEqual(
			before.map((column) => column.name),
		);
	});

	test("a locally changed issue keeps its rank and sprint membership", async () => {
		const client = new FakeClient() as unknown as JiraClient;
		await importJiraAgile(client, db, { privateApis: true });
		const [moved] = await db
			.select()
			.from(issues)
			.where(eq(issues.key, issueKeys[0]));
		await db.update(issues).set({ rank: "0|z" }).where(eq(issues.id, moved.id));
		const membershipCount = async () =>
			(
				await db
					.select()
					.from(issueSprints)
					.where(eq(issueSprints.issueId, moved.id))
			).length;
		expect(await membershipCount()).toBe(1);

		await importJiraAgile(client, db, { privateApis: true });

		const [kept] = await db
			.select()
			.from(issues)
			.where(eq(issues.id, moved.id));
		expect(kept.rank).toBe("0|z");
		expect(kept.locallyChangedAt).not.toBeNull();
		expect(await membershipCount()).toBe(1);

		await importJiraAgile(client, db, {
			overwriteLocal: true,
			privateApis: true,
		});
		const [reset] = await db
			.select()
			.from(issues)
			.where(eq(issues.id, moved.id));
		expect(reset.rank).toBe("0|a");
		expect(reset.locallyChangedAt).toBeNull();
		expect(await membershipCount()).toBe(1);
	});

	test("cleaning up one board keeps a sprint that another board still lists", async () => {
		await importJiraAgile(new FakeClient() as unknown as JiraClient, db, {
			privateApis: true,
		});
		const [sprintRow] = await db
			.select()
			.from(sprints)
			.where(eq(sprints.sourceId, String(sprintId)));
		const [other] = await db
			.insert(boards)
			.values({
				rapidViewId: secondRapidViewId,
				sourceId: String(secondRapidViewId),
				name: "Other board",
				type: "scrum",
				filterJql: "",
			})
			.returning();
		await db.insert(boardSprints).values({
			boardId: other.id,
			sprintId: sprintRow.id,
			sequence: 0,
		});

		await importJiraAgile(new FakeClient([]) as unknown as JiraClient, db, {
			privateApis: true,
		});

		const kept = await db
			.select()
			.from(boardSprints)
			.where(eq(boardSprints.boardId, other.id));
		expect(kept.map((row) => row.sprintId)).toEqual([sprintRow.id]);
	});

	test("imports a board when Jira has none of the Jira Software fields", async () => {
		class NoSoftwareFieldsClient extends FakeClient {
			override async getJson(path: string): Promise<unknown> {
				if (path === "/rest/api/2/field") return [];
				return super.getJson(path);
			}
		}
		const client = new NoSoftwareFieldsClient();
		const result = await importJiraAgile(client as unknown as JiraClient, db, {
			privateApis: true,
		});
		expect(result.boards).toBe(1);
		expect(result.issueSprints).toBe(2);
	});

	test("swapping the open sprint does not depend on the order of the rows", async () => {
		const secondSprintId = sprintId + 1;
		const sprintA = {
			...jiraSprint,
			id: sprintId,
			state: "active" as const,
			name: "Sprint A",
		};
		const sprintB = {
			...jiraSprint,
			id: secondSprintId,
			state: "closed" as const,
			name: "Sprint B",
		};
		await importJiraAgile(
			new FakeClient(
				[sprintA, sprintB],
				new Map([
					[sprintId, [issue(issueKeys[0], "0|a", statusIds[2])]],
					[secondSprintId, [issue(issueKeys[0], "0|a", statusIds[2])]],
				]),
			) as unknown as JiraClient,
			db,
			{ privateApis: true },
		);

		const result = await importJiraAgile(
			new FakeClient(
				[
					{ ...sprintB, state: "active" },
					{ ...sprintA, state: "closed" },
				],
				new Map([
					[secondSprintId, [issue(issueKeys[0], "0|a", statusIds[2])]],
					[sprintId, [issue(issueKeys[0], "0|a", statusIds[2])]],
				]),
			) as unknown as JiraClient,
			db,
			{ privateApis: true },
		);
		expect(result.issueSprints).toBe(2);

		const sprintRows = await db
			.select({ id: sprints.id, sourceId: sprints.sourceId })
			.from(sprints)
			.where(
				inArray(sprints.sourceId, [String(sprintId), String(secondSprintId)]),
			);
		const sprintAId = sprintRows.find(
			(row) => row.sourceId === String(sprintId),
		)?.id;
		const sprintBId = sprintRows.find(
			(row) => row.sourceId === String(secondSprintId),
		)?.id;
		const memberships = await db
			.select()
			.from(issueSprints)
			.where(eq(issueSprints.issueId, issueIds[0]));
		expect(memberships.find((row) => row.sprintId === sprintAId)?.isOpen).toBe(
			false,
		);
		expect(memberships.find((row) => row.sprintId === sprintBId)?.isOpen).toBe(
			true,
		);
	});
});
