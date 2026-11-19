import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	attachments,
	boards,
	comments,
	components,
	fields,
	issueAffectsVersions,
	issueComponents,
	issueFixVersions,
	issueHistory,
	issueHistoryItems,
	issueLinks,
	issueSprints,
	issues,
	linkTypes,
	resolutions,
	sprints,
	users,
	versions,
	watchers,
} from "../src/lib/server/schema.ts";
import { searchIssues } from "../src/lib/server/search/service.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = fixtureRun();
const key = fixtureKey(run);
const tag = `t-${run}`;
const NOW = new Date("2026-06-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

let app: TestApp;
let client: Client;
let session: string;
let alice: { id: string; username: string };
let bob: { id: string; username: string; displayName: string };
let projectId: string;
let typeId: string;
let todoStatusId: string;
let doneResolutionId: string;
let doneResolutionName: string;
let versionOne: string;
let versionTwo: string;
let customField: string;
let localIssueKey: string;
let localCommentId: string;

const ids: Record<string, string> = {};
const keys: Record<string, string> = {};

const FIXTURE = ["A", "B", "C", "D", "E"] as const;
const fixtureKeys = () => FIXTURE.map((name) => keys[name]);

function user() {
	return { id: alice.id, username: alice.username };
}

async function search(jql: string) {
	return searchIssues({ jql, startAt: 0, maxResults: 100 }, user(), {
		now: NOW,
		timeZone: "UTC",
	});
}

async function scopedKeys(jql: string) {
	const result = await search(
		`project = ${key} AND key in (${fixtureKeys().join(", ")}) AND (${jql})`,
	);
	return result.issues.map((issue) => issue.key).sort();
}

async function expectKeys(jql: string, expected: string[]) {
	expect(await scopedKeys(jql)).toEqual([...expected].sort());
}

function inject(
	method: "GET" | "POST" | "PATCH",
	url: string,
	payload?: unknown,
) {
	return app.inject({
		method,
		url,
		cookies: { sid: session },
		headers: { "x-requested-with": "rvna" },
		payload: payload as never,
	});
}

async function quicksearch(query: string) {
	const response = await inject(
		"GET",
		`/api/quicksearch?q=${encodeURIComponent(query)}`,
	);
	expect(response.statusCode).toBe(200);
	return (response.json() as { issues: { key: string }[] }).issues.map(
		(issue) => issue.key,
	);
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const loggedIn = await login(app, {
		sub: `sub-${run}`,
		username: `${tag}-alice`,
		name: "Alice Tester",
		email: `${tag}-alice@example.test`,
		groups: [],
	});
	session = loggedIn.sessionId as string;
	const aliceRow = await db
		.select({ id: users.id, username: users.username })
		.from(users)
		.where(eq(users.username, `${tag}-alice`))
		.limit(1);
	alice = aliceRow[0] as { id: string; username: string };
	const bobRow = await db
		.insert(users)
		.values({
			username: `${tag}-bob`,
			displayName: "Bob Tester",
			email: `${tag}-bob@example.test`,
		})
		.returning({ id: users.id, username: users.username });
	bob = {
		id: bobRow[0]?.id as string,
		username: bobRow[0]?.username as string,
		displayName: "Bob Tester",
	};

	const fixture = await createProjectFixture(client, {
		run,
		key,
		members: [alice.username],
		issues: [
			{
				summary: "Alpha zebra",
				description: "zebra alpha",
				labels: ["red"],
				created: "2026-06-15T00:00:00Z",
			},
			{
				summary: "Beta zebra",
				description: "beta text",
				labels: ["green"],
				assigneeId: alice.id,
				status: "done",
				created: "2026-06-15T12:00:00Z",
			},
			{
				summary: "Gamma",
				labels: [],
				assigneeId: bob.id,
				created: "2026-06-15T23:59:59Z",
			},
			{
				summary: "Delta",
				description: "delta text",
				labels: ["red", "green"],
				status: "done",
				created: "2026-06-16T00:00:00Z",
			},
			{
				summary: "Epsilon",
				description: "epsilon text",
				labels: [],
				created: "2026-06-14T10:00:00Z",
			},
		],
	});
	projectId = fixture.projectId;
	typeId = fixture.typeIds.task;
	todoStatusId = fixture.statusIds.todo;
	doneResolutionId = fixture.resolutionId;
	doneResolutionName = `${tag} Done`;
	await db
		.update(resolutions)
		.set({ name: doneResolutionName })
		.where(eq(resolutions.id, doneResolutionId));
	for (const [index, name] of FIXTURE.entries()) {
		ids[name] = fixture.issueIds[index] as string;
		keys[name] = fixture.issueKeys[index] as string;
	}

	const [cancelled] = await db
		.insert(resolutions)
		.values({
			sourceId: `fixture:${run}:resolution:cancelled`,
			name: "Cancelled",
		})
		.returning();

	await db
		.update(issues)
		.set({ sourceId: "900100001", assigneeId: null, resolutionId: null })
		.where(eq(issues.id, ids.A as string));
	await db
		.update(issues)
		.set({ sourceId: "900100002", assigneeId: alice.id })
		.where(eq(issues.id, ids.B as string));
	await db
		.update(issues)
		.set({ assigneeId: bob.id, resolutionId: null })
		.where(eq(issues.id, ids.C as string));
	await db
		.update(issues)
		.set({ assigneeId: null, resolutionId: cancelled?.id as string })
		.where(eq(issues.id, ids.D as string));
	await db
		.update(issues)
		.set({ assigneeId: null, resolutionId: null })
		.where(eq(issues.id, ids.E as string));

	const versionRows = await db
		.insert(versions)
		.values([
			{
				sourceId: `${tag}:version:1`,
				projectId,
				name: "Test 1.0",
				released: true,
			},
			{
				sourceId: `${tag}:version:2`,
				projectId,
				name: "Test 2.0",
			},
		])
		.returning({ id: versions.id, name: versions.name });
	versionOne = versionRows[0]?.id as string;
	versionTwo = versionRows[1]?.id as string;
	await db.insert(issueFixVersions).values([
		{
			sourceId: `${tag}:fix:1`,
			issueId: ids.A as string,
			versionId: versionOne,
		},
		{
			sourceId: `${tag}:fix:2`,
			issueId: ids.B as string,
			versionId: versionTwo,
		},
	]);
	await db.insert(issueAffectsVersions).values([
		{
			sourceId: `${tag}:affects:1`,
			issueId: ids.A as string,
			versionId: versionOne,
		},
		{
			sourceId: `${tag}:affects:2`,
			issueId: ids.B as string,
			versionId: versionTwo,
		},
	]);

	const componentRows = await db
		.insert(components)
		.values([
			{ sourceId: `${tag}:component:x`, projectId, name: "Component X" },
			{ sourceId: `${tag}:component:y`, projectId, name: "Component Y" },
		])
		.returning({ id: components.id });
	await db.insert(issueComponents).values([
		{
			sourceId: `${tag}:issue-component:a`,
			issueId: ids.A as string,
			componentId: componentRows[0]?.id as string,
		},
		{
			sourceId: `${tag}:issue-component:b`,
			issueId: ids.B as string,
			componentId: componentRows[1]?.id as string,
		},
	]);

	const [board] = await db
		.insert(boards)
		.values({
			rapidViewId: 900000 + Number.parseInt(run.slice(0, 5), 16),
			sourceId: `${tag}:board`,
			name: "JQL semantics board",
			type: "scrum",
			filterJql: `project = ${key}`,
			projectId,
		})
		.returning();
	const sprintRows = await db
		.insert(sprints)
		.values([
			{
				sourceId: `${tag}:sprint:1`,
				boardId: board.id,
				name: "Sprint One",
				state: "future",
			},
			{
				sourceId: `${tag}:sprint:2`,
				boardId: board.id,
				name: "Sprint Two",
				state: "future",
			},
		])
		.returning({ id: sprints.id });
	await db.insert(issueSprints).values([
		{
			issueId: ids.A as string,
			sprintId: sprintRows[0]?.id as string,
			isOpen: true,
		},
		{
			issueId: ids.B as string,
			sprintId: sprintRows[1]?.id as string,
			isOpen: true,
		},
	]);

	await db.insert(attachments).values({
		sourceId: `${tag}:attachment:b`,
		issueId: ids.B as string,
		fileName: "b.txt",
		storagePath: `${tag}/b.txt`,
		sha256: "0".repeat(64),
	});

	await db.insert(watchers).values([
		{
			sourceId: `${tag}:watcher:a`,
			issueId: ids.A as string,
			userId: alice.id,
		},
		{ sourceId: `${tag}:watcher:b`, issueId: ids.B as string, userId: bob.id },
	]);

	const [relates] = await db
		.insert(linkTypes)
		.values({
			sourceId: `${tag}:link:relates`,
			name: "Test Relates",
			inward: "relates to",
			outward: "relates to",
		})
		.returning();
	await db.insert(issueLinks).values({
		sourceId: `${tag}:link:1`,
		typeId: relates.id,
		sourceIssueId: ids.A as string,
		targetIssueId: ids.B as string,
	});

	const [custom] = await db
		.insert(fields)
		.values({
			sourceId: `${tag}:field:test-text`,
			name: "Test Text",
			type: "string",
		})
		.returning();
	customField = custom.sourceId;
	for (const name of ["A", "B", "E"] as const) {
		await db
			.update(issues)
			.set({ custom: { [customField]: "hello" } })
			.where(eq(issues.id, ids[name] as string));
	}
	await db
		.update(issues)
		.set({ custom: { [customField]: "other" } })
		.where(eq(issues.id, ids.D as string));

	await db.insert(comments).values([
		{
			sourceId: `${tag}:comment:a`,
			issueId: ids.A as string,
			authorId: alice.id,
			bodySource: "special alpha",
			bodyHtml: "<p>special alpha</p>",
			created: new Date(NOW.getTime() - 2 * DAY),
		},
		{
			sourceId: `${tag}:comment:b`,
			issueId: ids.B as string,
			authorId: alice.id,
			bodySource: "special beta",
			bodyHtml: "<p>special beta</p>",
			created: new Date(NOW.getTime() - 2 * DAY),
		},
	]);

	const historyRows = await db
		.insert(issueHistory)
		.values([
			{
				sourceId: `${tag}:history:c-resolution`,
				issueId: ids.C as string,
				authorId: alice.id,
				created: new Date(NOW.getTime() - 5 * DAY),
			},
			{
				sourceId: `${tag}:history:a-fix`,
				issueId: ids.A as string,
				authorId: alice.id,
				created: new Date(NOW.getTime() - 4 * DAY),
			},
			{
				sourceId: `${tag}:history:a-assignee`,
				issueId: ids.A as string,
				authorId: alice.id,
				created: new Date(NOW.getTime() - 3 * DAY),
			},
		])
		.returning();
	await db.insert(issueHistoryItems).values([
		{
			sourceId: `${tag}:item:c-resolution`,
			historyId: historyRows[0]?.id as string,
			field: "resolution",
			fieldType: "jira",
			fromValue: "",
			fromText: "",
			toValue: doneResolutionId,
			toText: doneResolutionName,
			sequence: 0,
		},
		{
			sourceId: `${tag}:item:a-fix`,
			historyId: historyRows[1]?.id as string,
			field: "Fix Version",
			fieldType: "jira",
			fromValue: "",
			fromText: "",
			toValue: versionOne,
			toText: "Test 1.0",
			sequence: 0,
		},
		{
			sourceId: `${tag}:item:a-assignee`,
			historyId: historyRows[2]?.id as string,
			field: "assignee",
			fieldType: "jira",
			fromValue: "",
			fromText: "",
			toValue: bob.id,
			toText: bob.displayName,
			sequence: 0,
		},
	]);

	await db
		.update(issues)
		.set({ parentId: ids.A as string, epicId: ids.B as string })
		.where(eq(issues.id, ids.C as string));
});

afterAll(async () => {
	if (client) {
		await dropProjectFixture(client, run);
		await client.end();
	}
	await db.delete(fields).where(eq(fields.sourceId, `${tag}:field:test-text`));
	await db
		.delete(linkTypes)
		.where(eq(linkTypes.sourceId, `${tag}:link:relates`));
	await db.delete(boards).where(eq(boards.sourceId, `${tag}:board`));
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

describe("finding 1: locally written text is searchable", () => {
	test("a created description and comment are searchable immediately", async () => {
		const response = await inject("POST", "/api/issues", {
			project: key,
			type: typeId,
			summary: "Local issue",
			description: "<p>quokka</p>",
		});
		expect(response.statusCode).toBe(201);
		localIssueKey = response.json().key as string;

		expect(await quicksearch("quokka")).toContain(localIssueKey);
		expect(
			(await search(`project = ${key} AND description ~ quokka`)).total,
		).toBeGreaterThan(0);
		expect(
			(await search(`project = ${key} AND text ~ quokka`)).total,
		).toBeGreaterThan(0);
		expect(
			(await search(`project = ${key} AND summary ~ "Local issue"`)).total,
		).toBeGreaterThan(0);

		const comment = await inject(
			"POST",
			`/api/issues/${localIssueKey}/comments`,
			{ body: "<p>narwhal</p>" },
		);
		expect(comment.statusCode).toBe(201);
		localCommentId = comment.json().id as string;

		expect(await quicksearch("narwhal")).toContain(localIssueKey);
		expect((await search(`project = ${key} AND comment ~ narwhal`)).total).toBe(
			1,
		);
		expect((await search(`project = ${key} AND text ~ narwhal`)).total).toBe(1);

		const edited = await inject("PATCH", `/api/issues/${localIssueKey}`, {
			description: "<p>quokka updated</p>",
		});
		expect(edited.statusCode).toBe(200);
		expect(
			(await search(`project = ${key} AND description ~ updated`)).total,
		).toBe(1);
		expect(
			(await search(`project = ${key} AND description ~ quokka`)).total,
		).toBe(1);

		const editedComment = await inject(
			"PATCH",
			`/api/issues/${localIssueKey}/comments/${localCommentId}`,
			{ body: "<p>narwhal revised</p>" },
		);
		expect(editedComment.statusCode).toBe(200);
		expect((await search(`project = ${key} AND comment ~ revised`)).total).toBe(
			1,
		);
		expect((await search(`project = ${key} AND comment ~ narwhal`)).total).toBe(
			1,
		);
	});

	test("the migration backfills source columns of rows written before the fix", async () => {
		const [before] = await db
			.insert(issues)
			.values({
				sourceId: `local:${randomUUID()}`,
				projectId,
				number: 99,
				key: `${key}-99`,
				typeId,
				statusId: todoStatusId,
				summary: "Prebackfill issue",
				descriptionHtml: "<p>prebackfill capybara</p>",
				descriptionSource: null,
				created: new Date("2026-06-10T10:00:00Z"),
				updated: new Date("2026-06-10T10:00:00Z"),
				custom: {},
			})
			.returning({ key: issues.key });

		expect(await quicksearch("capybara")).not.toContain(before.key);
		expect(
			(await search(`project = ${key} AND description ~ capybara`)).total,
		).toBe(0);

		const files = await readdir(new URL("../drizzle", import.meta.url));
		const migration = files.find((file) =>
			file.endsWith("_backfill_search_sources.sql"),
		);
		expect(migration).toBeTruthy();
		await pool.query(
			await readFile(
				new URL(`../drizzle/${migration as string}`, import.meta.url),
				"utf8",
			),
		);

		expect(await quicksearch("capybara")).toContain(before.key);
		expect(
			(await search(`project = ${key} AND description ~ capybara`)).total,
		).toBe(1);
		expect((await search(`project = ${key} AND text ~ capybara`)).total).toBe(
			1,
		);
	});
});

describe("finding 2: negated operators follow Jira", () => {
	test("resolution negations exclude unresolved", async () => {
		await expectKeys(`resolution = "${doneResolutionName}"`, [
			keys.B as string,
		]);
		await expectKeys(`resolution != "${doneResolutionName}"`, [
			keys.D as string,
		]);
		await expectKeys(`resolution not in ("${doneResolutionName}")`, [
			keys.D as string,
		]);
		await expectKeys(`NOT (resolution = "${doneResolutionName}")`, [
			keys.D as string,
		]);
		await expectKeys(`resolution is EMPTY`, [
			keys.A as string,
			keys.C as string,
			keys.E as string,
		]);
		await expectKeys(`resolution is not EMPTY`, [
			keys.B as string,
			keys.D as string,
		]);
	});

	test("EMPTY in an IN list adds the empty values", async () => {
		await expectKeys(`resolution in ("${doneResolutionName}", EMPTY)`, [
			keys.A as string,
			keys.B as string,
			keys.C as string,
			keys.E as string,
		]);
		await expectKeys(`resolution not in ("${doneResolutionName}", EMPTY)`, [
			keys.D as string,
		]);
		await expectKeys(`resolution in (EMPTY)`, [
			keys.A as string,
			keys.C as string,
			keys.E as string,
		]);
		await expectKeys(`resolution not in (EMPTY)`, [
			keys.B as string,
			keys.D as string,
		]);
		await expectKeys(`labels in (red, EMPTY)`, [
			keys.A as string,
			keys.C as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`labels not in (red, EMPTY)`, [keys.B as string]);
		await expectKeys(`labels in (EMPTY)`, [keys.C as string, keys.E as string]);
		await expectKeys(`labels not in (EMPTY)`, [
			keys.A as string,
			keys.B as string,
			keys.D as string,
		]);
	});

	test("assignee negations exclude unassigned issues", async () => {
		await expectKeys(`assignee = "${alice.username}"`, [keys.B as string]);
		await expectKeys(`assignee != "${alice.username}"`, [keys.C as string]);
		await expectKeys(`assignee not in ("${alice.username}")`, [
			keys.C as string,
		]);
		await expectKeys(`NOT (assignee = "${alice.username}")`, [
			keys.C as string,
		]);
		await expectKeys(`assignee is EMPTY`, [
			keys.A as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`assignee is not EMPTY`, [
			keys.B as string,
			keys.C as string,
		]);
	});

	test("fixVersion negations exclude issues without a fix version", async () => {
		await expectKeys(`fixVersion = "Test 1.0"`, [keys.A as string]);
		await expectKeys(`fixVersion != "Test 1.0"`, [keys.B as string]);
		await expectKeys(`fixVersion not in ("Test 1.0")`, [keys.B as string]);
		await expectKeys(`NOT (fixVersion = "Test 1.0")`, [keys.B as string]);
		await expectKeys(`fixVersion is EMPTY`, [
			keys.C as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`fixVersion is not EMPTY`, [
			keys.A as string,
			keys.B as string,
		]);
	});

	test("labels negations exclude issues without labels", async () => {
		await expectKeys(`labels = red`, [keys.A as string, keys.D as string]);
		await expectKeys(`labels != red`, [keys.B as string]);
		await expectKeys(`labels not in (red)`, [keys.B as string]);
		await expectKeys(`NOT (labels = red)`, [keys.B as string]);
		await expectKeys(`labels is EMPTY`, [keys.C as string, keys.E as string]);
		await expectKeys(`labels is not EMPTY`, [
			keys.A as string,
			keys.B as string,
			keys.D as string,
		]);
	});

	test("attachments supports only EMPTY checks", async () => {
		await expectKeys(`attachments is not EMPTY`, [keys.B as string]);
		await expectKeys(`attachments is EMPTY`, [
			keys.A as string,
			keys.C as string,
			keys.D as string,
			keys.E as string,
		]);
	});

	test("custom text negations exclude issues without the field", async () => {
		await expectKeys(`"Test Text" = hello`, [
			keys.A as string,
			keys.B as string,
			keys.E as string,
		]);
		await expectKeys(`"Test Text" != hello`, [keys.D as string]);
		await expectKeys(`"Test Text" not in (hello)`, [keys.D as string]);
		await expectKeys(`NOT ("Test Text" = hello)`, [keys.D as string]);
		await expectKeys(`"Test Text" is EMPTY`, [keys.C as string]);
		await expectKeys(`"Test Text" is not EMPTY`, [
			keys.A as string,
			keys.B as string,
			keys.D as string,
			keys.E as string,
		]);
	});

	test("multi-valued fields require a value for negation", async () => {
		await expectKeys(`component = "Component X"`, [keys.A as string]);
		await expectKeys(`component != "Component X"`, [keys.B as string]);
		await expectKeys(`NOT (component = "Component X")`, [keys.B as string]);
		await expectKeys(`sprint = "Sprint One"`, [keys.A as string]);
		await expectKeys(`sprint != "Sprint One"`, [keys.B as string]);
		await expectKeys(`NOT (sprint = "Sprint One")`, [keys.B as string]);
		await expectKeys(`watcher = "${alice.username}"`, [keys.A as string]);
		await expectKeys(`watcher != "${alice.username}"`, [keys.B as string]);
		await expectKeys(`NOT (watcher = "${alice.username}")`, [keys.B as string]);
		await expectKeys(`affectedVersion = "Test 1.0"`, [keys.A as string]);
		await expectKeys(`affectedVersion != "Test 1.0"`, [keys.B as string]);
		await expectKeys(`NOT (affectedVersion = "Test 1.0")`, [keys.B as string]);
	});

	test("parent negations include issues without a parent", async () => {
		await expectKeys(`parent = ${keys.A}`, [keys.C as string]);
		await expectKeys(`parent != ${keys.A}`, [
			keys.A as string,
			keys.B as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`parent not in (${keys.A})`, [
			keys.A as string,
			keys.B as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`NOT (parent = ${keys.A})`, [
			keys.A as string,
			keys.B as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`"Epic Link" = ${keys.B}`, [keys.C as string]);
		await expectKeys(`"Epic Link" != ${keys.B}`, []);
		await expectKeys(`NOT ("Epic Link" = ${keys.B})`, []);
	});

	test("issueLinkType negations include issues without links", async () => {
		await expectKeys(`issueLinkType = "Test Relates"`, [
			keys.A as string,
			keys.B as string,
		]);
		await expectKeys(`issueLinkType != "Test Relates"`, [
			keys.C as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`NOT (issueLinkType = "Test Relates")`, [
			keys.C as string,
			keys.D as string,
			keys.E as string,
		]);
	});

	test("text negations exclude empty descriptions and comments", async () => {
		await expectKeys(`description ~ alpha`, [keys.A as string]);
		await expectKeys(`description !~ alpha`, [
			keys.B as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`NOT (description ~ alpha)`, [
			keys.B as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`description is EMPTY`, [keys.C as string]);
		await expectKeys(`comment ~ special`, [keys.A as string, keys.B as string]);
		await expectKeys(`comment !~ alpha`, [keys.B as string]);
		await expectKeys(`NOT (comment ~ alpha)`, [keys.B as string]);
		await expectKeys(`summary !~ zebra`, [
			keys.C as string,
			keys.D as string,
			keys.E as string,
		]);
	});

	test("was not includes issues that never had the value", async () => {
		await expectKeys(`resolution was "${doneResolutionName}"`, [
			keys.B as string,
			keys.C as string,
		]);
		await expectKeys(`resolution was not "${doneResolutionName}"`, [
			keys.A as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`resolution was not in ("${doneResolutionName}")`, [
			keys.A as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`NOT (resolution was "${doneResolutionName}")`, [
			keys.A as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`assignee was "${bob.username}"`, [
			keys.A as string,
			keys.C as string,
		]);
		await expectKeys(`assignee was not "${bob.username}"`, [
			keys.B as string,
			keys.D as string,
			keys.E as string,
		]);
	});
});

describe("finding 3: local source ids do not break id queries", () => {
	test("id comparisons ignore non-numeric source ids", async () => {
		await expectKeys(`id = 900100001`, [keys.A as string]);
		await expectKeys(`id > 900100001`, [keys.B as string]);
		await expectKeys(`id >= 900100001`, [keys.A as string, keys.B as string]);
		await expectKeys(`id < 900100002`, [keys.A as string]);
		await expectKeys(`id <= 900100001`, [keys.A as string]);
	});

	test("a local issue in the project does not break id comparisons", async () => {
		const result = await search(`project = ${key} AND id > 900100001`);
		expect(result.issues.map((issue) => issue.key)).toEqual([keys.B]);
	});

	test("ORDER BY id mixes imported and local issues", async () => {
		const result = await search(`project = ${key} ORDER BY id ASC`);
		expect(result.total).toBeGreaterThanOrEqual(7);
		const ordered = result.issues.map((issue) => issue.key);
		expect(ordered.slice(0, 2)).toEqual([keys.A, keys.B]);
		expect(ordered).toContain(localIssueKey);
		expect(ordered.indexOf(localIssueKey)).toBeGreaterThan(1);
	});

	test("every orderable field sorts with local and imported issues mixed", async () => {
		const orderable = [
			"project",
			"issuetype",
			"status",
			"statusCategory",
			"priority",
			"resolution",
			"assignee",
			"reporter",
			"creator",
			"watcher",
			"summary",
			"description",
			"labels",
			"component",
			"fixVersion",
			"affectedVersion",
			"created",
			"updated",
			"resolved",
			"due",
			"storyPoints",
			"originalEstimate",
			"remainingEstimate",
			"timespent",
			"sprint",
			"rank",
			`"Time to resolution"`,
			"key",
			"id",
			"parent",
			"epicLink",
			`"Test Text"`,
		];
		for (const field of orderable) {
			const result = await search(`project = ${key} ORDER BY ${field} ASC`);
			expect(result.total).toBeGreaterThanOrEqual(7);
		}
	});
});

describe("finding 4: date-only literals keep Jira's exact-midnight rule", () => {
	test("every comparison operator matches live Jira's UTC midnight boundary", async () => {
		await expectKeys(`created = "2026-06-15"`, [keys.A as string]);
		await expectKeys(`created != "2026-06-15"`, [
			keys.B as string,
			keys.C as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`created > "2026-06-15"`, [
			keys.B as string,
			keys.C as string,
			keys.D as string,
		]);
		await expectKeys(`created >= "2026-06-15"`, [
			keys.A as string,
			keys.B as string,
			keys.C as string,
			keys.D as string,
		]);
		await expectKeys(`created < "2026-06-15"`, [keys.E as string]);
		await expectKeys(`created <= "2026-06-15"`, [
			keys.A as string,
			keys.E as string,
		]);
		await expectKeys(`created in ("2026-06-15")`, [keys.A as string]);
		await expectKeys(`created not in ("2026-06-15")`, [
			keys.B as string,
			keys.C as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`created = "2026-06-15 12:00"`, [keys.B as string]);
	});

	test("startOfDay-style functions stay exact instants", async () => {
		await expectKeys(`created = startOfDay()`, [keys.A as string]);
		await expectKeys(`created >= startOfDay()`, [
			keys.A as string,
			keys.B as string,
			keys.C as string,
			keys.D as string,
		]);
		await expectKeys(`created < startOfDay()`, [keys.E as string]);
		await expectKeys(`created <= startOfDay()`, [
			keys.A as string,
			keys.E as string,
		]);
		await expectKeys(`created > endOfDay()`, [keys.D as string]);
		await expectKeys(`created <= endOfDay()`, [
			keys.A as string,
			keys.B as string,
			keys.C as string,
			keys.E as string,
		]);
	});
});

describe("finding 5: fixVersion history uses one canonical field name", () => {
	test("imported Fix Version history matches was and changed", async () => {
		await expectKeys(`fixVersion changed`, [keys.A as string]);
		await expectKeys(`fixVersion was "Test 1.0"`, [keys.A as string]);
		await expectKeys(`fixVersion was not "Test 1.0"`, [
			keys.B as string,
			keys.C as string,
			keys.D as string,
			keys.E as string,
		]);
		await expectKeys(`fixVersion changed to "Test 1.0"`, [keys.A as string]);
	});

	test("a local fix version edit writes history JQL can read", async () => {
		const edited = await inject("PATCH", `/api/issues/${keys.E}`, {
			fixVersions: [versionTwo],
		});
		expect(edited.statusCode).toBe(200);
		await expectKeys(`fixVersion changed`, [
			keys.A as string,
			keys.E as string,
		]);
		await expectKeys(`fixVersion was "Test 2.0"`, [
			keys.B as string,
			keys.E as string,
		]);
		await expectKeys(`fixVersion changed to "Test 2.0"`, [keys.E as string]);
	});
});
