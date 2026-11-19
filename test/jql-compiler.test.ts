import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	boards,
	comments,
	components,
	fields,
	issueAffectsVersions,
	issueComponents,
	issueFixVersions,
	issueHistory,
	issueHistoryItems,
	issueLabels,
	issueLinks,
	issueSprints,
	issues,
	issueTypes,
	linkTypes,
	priorities,
	projects,
	resolutions,
	sprints,
	statuses,
	users,
	versions,
	watchers,
} from "../src/lib/server/schema.ts";
import { searchIssues } from "../src/lib/server/search/service.ts";
import { JqlError } from "../src/lib/shared/jql/index.ts";

const KEY = "JQLT";
const PROJECT_NAME = "JQL Test Project";
const NOW = new Date("2026-06-15T12:00:00.000Z");
const run = randomUUID().slice(0, 8);

const CUSTOM_TEXT = "customfield_99001";
const CUSTOM_NUMBER = "customfield_99002";
const CUSTOM_SELECT = "customfield_99003";
const CUSTOM_CASCADE = "customfield_99004";
const CUSTOM_USER = "customfield_99005";
const CUSTOM_DATE = "customfield_99006";

const tag = `jqlt-${run}`;
const username = (name: string) => `${tag}-${name}`;

const ids = {
	alice: "",
	bob: "",
	project: "",
	bug: "",
	task: "",
	subtask: "",
	open: "",
	progress: "",
	done: "",
	high: "",
	low: "",
	fixed: "",
	component: "",
	version1: "",
	version2: "",
	relates: "",
};

const issueIds: Record<string, string> = {};

function days(offset: number) {
	return new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);
}

async function cleanup() {
	const existing = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.key, KEY));
	for (const project of existing) {
		await pool.query("delete from boards where source_id like $1", [`${tag}%`]);
		await pool.query("delete from issues where project_id = $1", [project.id]);
		await pool.query("delete from versions where project_id = $1", [
			project.id,
		]);
		await pool.query("delete from components where project_id = $1", [
			project.id,
		]);
		await pool.query("delete from projects where id = $1", [project.id]);
	}
	for (const table of [
		"issue_types",
		"statuses",
		"priorities",
		"resolutions",
	]) {
		await pool.query(`delete from ${table} where source_id like 'jqlt-%'`);
	}
	await pool.query(
		"delete from fields where source_id like 'customfield_9900%'",
	);
	await pool.query("delete from link_types where source_id like 'jqlt-%'");
	await pool.query("delete from groups where name like 'jqlt-%'");
	await pool.query("delete from users where username like 'jqlt-%'");
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();

	const [alice, bob] = await db
		.insert(users)
		.values([
			{
				username: username("alice"),
				displayName: "Alice Tester",
				email: `${username("alice")}@example.test`,
			},
			{
				username: username("bob"),
				displayName: "Bob Tester",
				email: `${username("bob")}@example.test`,
			},
		])
		.returning();
	ids.alice = alice.id;
	ids.bob = bob.id;

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}-project`,
			key: KEY,
			name: PROJECT_NAME,
			projectType: "software",
		})
		.returning();
	ids.project = project.id;

	const types = await db
		.insert(issueTypes)
		.values([
			{ sourceId: `${tag}-bug`, name: "Test Bug" },
			{ sourceId: `${tag}-task`, name: "Test Task" },
			{ sourceId: `${tag}-subtask`, name: "Test Sub", subtask: true },
		])
		.returning();
	ids.bug = types[0].id;
	ids.task = types[1].id;
	ids.subtask = types[2].id;

	const statusesRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}-open`, name: "Test Open", category: "new" },
			{
				sourceId: `${tag}-progress`,
				name: "Test Progress",
				category: "indeterminate",
			},
			{ sourceId: `${tag}-done`, name: "Test Done", category: "done" },
		])
		.returning();
	ids.open = statusesRows[0].id;
	ids.progress = statusesRows[1].id;
	ids.done = statusesRows[2].id;

	const priorityRows = await db
		.insert(priorities)
		.values([
			{ sourceId: `${tag}-high`, name: "Test High", sequence: 1 },
			{ sourceId: `${tag}-low`, name: "Test Low", sequence: 2 },
		])
		.returning();
	ids.high = priorityRows[0].id;
	ids.low = priorityRows[1].id;

	const [resolution] = await db
		.insert(resolutions)
		.values({ sourceId: `${tag}-fixed`, name: "Test Fixed" })
		.returning();
	ids.fixed = resolution.id;

	const versionRows = await db
		.insert(versions)
		.values([
			{
				sourceId: `${tag}-v1`,
				projectId: ids.project,
				name: "Test 1.0",
				released: true,
			},
			{
				sourceId: `${tag}-v2`,
				projectId: ids.project,
				name: "Test 2.0",
				released: false,
			},
		])
		.returning();
	ids.version1 = versionRows[0].id;
	ids.version2 = versionRows[1].id;

	const [component] = await db
		.insert(components)
		.values({
			sourceId: `${tag}-component`,
			projectId: ids.project,
			name: "Test Comp",
		})
		.returning();
	ids.component = component.id;

	const [relates] = await db
		.insert(linkTypes)
		.values({
			sourceId: `${tag}-relates`,
			name: "Test Relates",
			inward: "relates to",
			outward: "relates to",
		})
		.returning();
	ids.relates = relates.id;

	const fieldRows = await db
		.insert(fields)
		.values([
			{ sourceId: CUSTOM_TEXT, name: "Test Text", type: "string" },
			{ sourceId: CUSTOM_NUMBER, name: "Test Number", type: "number" },
			{
				sourceId: CUSTOM_SELECT,
				name: "Test Select",
				type: "option",
				customKey: "com.atlassian.jira.plugin.system.customfieldtypes:select",
			},
			{
				sourceId: CUSTOM_CASCADE,
				name: "Test Cascade",
				type: "option-with-child",
				customKey:
					"com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect",
			},
			{
				sourceId: CUSTOM_USER,
				name: "Test User",
				type: "array",
				customKey:
					"com.atlassian.jira.plugin.system.customfieldtypes:multiuserpicker",
			},
			{
				sourceId: CUSTOM_DATE,
				name: "Test Date",
				type: "datetime",
				customKey: "com.atlassian.jira.plugin.system.customfieldtypes:datetime",
			},
		])
		.returning();

	const selectField = fieldRows.find((row) => row.sourceId === CUSTOM_SELECT);
	const cascadeField = fieldRows.find((row) => row.sourceId === CUSTOM_CASCADE);
	if (!selectField || !cascadeField) throw new Error("custom fields missing");

	await db.execute(sql`
		insert into field_options (source_id, field_id, value, sequence) values
			(${`${tag}-opt-a`}, ${selectField.id}, 'Alpha', 1),
			(${`${tag}-opt-b`}, ${selectField.id}, 'Beta', 2),
			(${`${tag}-opt-p`}, ${cascadeField.id}, 'Parent', 1),
			(${`${tag}-opt-c`}, ${cascadeField.id}, 'Child', 2)
	`);

	const issueRows = await db
		.insert(issues)
		.values([
			{
				sourceId: "900000001",
				projectId: ids.project,
				number: 1,
				key: `${KEY}-1`,
				typeId: ids.bug,
				statusId: ids.open,
				priorityId: ids.high,
				summary: "Alpha widget fails",
				descriptionSource: "the alpha widget breaks badly",
				reporterId: ids.alice,
				assigneeId: ids.alice,
				creatorId: ids.alice,
				storyPoints: 5,
				originalEstimate: 3600,
				remainingEstimate: 1800,
				timeSpent: 600,
				dueDate: "2026-06-16",
				created: days(-10),
				updated: days(-2),
				rank: "0|aaa",
				custom: {
					[CUSTOM_TEXT]: "hello",
					[CUSTOM_NUMBER]: 42,
					[CUSTOM_SELECT]: { id: "1", value: "Alpha" },
					[CUSTOM_CASCADE]: { value: "Parent", child: { value: "Child" } },
					[CUSTOM_USER]: [{ name: username("alice") }],
					[CUSTOM_DATE]: "2026-06-01T10:00:00.000+0000",
				},
			},
			{
				sourceId: "900000002",
				projectId: ids.project,
				number: 2,
				key: `${KEY}-2`,
				typeId: ids.task,
				statusId: ids.done,
				priorityId: ids.low,
				resolutionId: ids.fixed,
				summary: "Beta service down",
				descriptionSource: "beta outage",
				reporterId: ids.alice,
				assigneeId: ids.bob,
				creatorId: ids.alice,
				dueDate: "2026-06-12",
				created: days(-20),
				updated: days(-1),
				resolved: days(-1),
				rank: "0|aab",
				custom: {
					[CUSTOM_USER]: [{ name: username("bob") }],
				},
			},
			{
				sourceId: "900000003",
				projectId: ids.project,
				number: 3,
				key: `${KEY}-3`,
				typeId: ids.subtask,
				statusId: ids.progress,
				summary: "Gamma subtask",
				created: days(-5),
				updated: days(-3),
				rank: "0|aac",
				custom: {},
			},
			{
				sourceId: "900000004",
				projectId: ids.project,
				number: 4,
				key: `${KEY}-4`,
				typeId: ids.task,
				statusId: ids.open,
				summary: "Delta empty",
				created: days(-30),
				updated: days(-4),
				custom: {},
			},
		])
		.returning();

	for (const row of issueRows) issueIds[row.key.slice(KEY.length + 1)] = row.id;
	const a = issueIds["1"];
	const b = issueIds["2"];
	const c = issueIds["3"];

	const [sprintBoard] = await db
		.insert(boards)
		.values({
			rapidViewId: 990,
			sourceId: `${tag}-board`,
			name: "JQL sprint board",
			type: "scrum",
			filterJql: `project = ${KEY}`,
			projectId: ids.project,
		})
		.returning();
	const sprintRows = await db
		.insert(sprints)
		.values([
			{
				sourceId: `${tag}-sprint-open`,
				boardId: sprintBoard.id,
				name: "Test Sprint Open",
				state: "active",
				sequence: 1,
			},
			{
				sourceId: `${tag}-sprint-closed`,
				boardId: sprintBoard.id,
				name: "Test Sprint Closed",
				state: "closed",
				sequence: 2,
			},
			{
				sourceId: `${tag}-sprint-future`,
				boardId: sprintBoard.id,
				name: "Test Sprint Future",
				state: "future",
				sequence: 3,
			},
		])
		.returning();
	const openSprint = sprintRows.find((row) => row.state === "active");
	const closedSprint = sprintRows.find((row) => row.state === "closed");
	const futureSprint = sprintRows.find((row) => row.state === "future");
	if (!openSprint || !closedSprint || !futureSprint) {
		throw new Error("sprints missing");
	}
	await db.insert(issueSprints).values([
		{ issueId: a, sprintId: openSprint.id },
		{ issueId: b, sprintId: futureSprint.id },
		{ issueId: c, sprintId: closedSprint.id },
	]);

	await db.update(issues).set({ parentId: a }).where(eq(issues.id, c));
	await db.update(issues).set({ epicId: b }).where(eq(issues.id, c));

	await db.insert(issueLabels).values([
		{ sourceId: `${tag}-l1`, issueId: a, label: "red" },
		{ sourceId: `${tag}-l2`, issueId: a, label: "blue" },
		{ sourceId: `${tag}-l3`, issueId: b, label: "green" },
		{ sourceId: `${tag}-l4`, issueId: c, label: "red" },
	]);

	await db
		.insert(issueComponents)
		.values({ sourceId: `${tag}-ic1`, issueId: a, componentId: ids.component });
	await db.insert(issueFixVersions).values([
		{ sourceId: `${tag}-fv1`, issueId: a, versionId: ids.version1 },
		{ sourceId: `${tag}-fv2`, issueId: b, versionId: ids.version2 },
	]);
	await db
		.insert(issueAffectsVersions)
		.values({ sourceId: `${tag}-av1`, issueId: b, versionId: ids.version2 });

	await db.insert(watchers).values([
		{ sourceId: `${tag}-w1`, issueId: b, userId: ids.alice },
		{ sourceId: `${tag}-w2`, issueId: a, userId: ids.bob },
	]);

	await db.insert(comments).values([
		{
			sourceId: `${tag}-c1`,
			issueId: b,
			authorId: ids.alice,
			bodySource: "special comment text",
			created: days(-2),
		},
		{
			sourceId: `${tag}-c2`,
			issueId: a,
			authorId: ids.alice,
			bodySource: "alpha note",
			created: days(-3),
		},
	]);

	await db.insert(issueLinks).values({
		sourceId: `${tag}-link1`,
		typeId: ids.relates,
		sourceIssueId: a,
		targetIssueId: b,
	});

	const historyRows = await db
		.insert(issueHistory)
		.values([
			{
				sourceId: `${tag}-h1`,
				issueId: a,
				authorId: ids.alice,
				created: days(-6),
			},
			{
				sourceId: `${tag}-h2`,
				issueId: a,
				authorId: ids.alice,
				created: days(-4),
			},
			{
				sourceId: `${tag}-h3`,
				issueId: a,
				authorId: ids.bob,
				created: days(-1),
			},
		])
		.returning();

	await db.insert(issueHistoryItems).values([
		{
			sourceId: `${tag}-i1`,
			historyId: historyRows[0].id,
			field: "status",
			fieldType: "jira",
			fromValue: "1",
			fromText: "Test Open",
			toValue: "2",
			toText: "Test Progress",
			sequence: 0,
		},
		{
			sourceId: `${tag}-i2`,
			historyId: historyRows[1].id,
			field: "assignee",
			fieldType: "jira",
			fromValue: "",
			fromText: "",
			toValue: "bob",
			toText: "Bob Tester",
			sequence: 0,
		},
		{
			sourceId: `${tag}-i3`,
			historyId: historyRows[2].id,
			field: "status",
			fieldType: "jira",
			fromValue: "2",
			fromText: "Test Progress",
			toValue: "1",
			toText: "Test Open",
			sequence: 0,
		},
	]);

	const groupResult = await db.execute(
		sql`insert into groups (name) values (${`${tag}-team`}) returning id`,
	);
	const [group] = groupResult.rows as { id: string }[];
	await db.execute(sql`
		insert into user_groups (user_id, group_id) values
			(${ids.alice}, ${group.id}),
			(${ids.bob}, ${group.id})
	`);
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

const alice = () => ({ id: ids.alice, username: username("alice") });

async function keys(jql: string, user = alice()) {
	const result = await searchIssues(
		{ jql, startAt: 0, maxResults: 100 },
		user,
		{ now: NOW },
	);
	return result.issues.map((issue) => issue.key);
}

async function sorted(jql: string, user = alice()) {
	return (await keys(jql, user)).sort();
}

const A = `${KEY}-1`;
const B = `${KEY}-2`;
const C = `${KEY}-3`;
const D = `${KEY}-4`;

async function expectKeys(jql: string, expected: string[]) {
	expect(await sorted(`project = ${KEY} AND (${jql})`)).toEqual(
		[...expected].sort(),
	);
}

async function expectError(jql: string, message: string) {
	try {
		await keys(jql);
		throw new Error(`expected ${jql} to fail`);
	} catch (error) {
		expect(error).toBeInstanceOf(JqlError);
		expect((error as JqlError).message).toBe(message);
	}
}

describe("JQL compiler: fields and operators", () => {
	test("project by key, name and id", async () => {
		await expectKeys(`project = ${KEY}`, [A, B, C, D]);
		await expectKeys(`project = "${PROJECT_NAME}"`, [A, B, C, D]);
		await expectKeys(`project = ${ids.project}`, [A, B, C, D]);
		await expectKeys(`PROJECT = ${KEY}`, [A, B, C, D]);
		await expectKeys(`project != ${KEY}`, []);
	});

	test("issue type", async () => {
		await expectKeys(`issuetype = "Test Bug"`, [A]);
		await expectKeys(`type in ("Test Bug", "Test Task")`, [A, B, D]);
		await expectKeys(`issuetype = "Test Sub"`, [C]);
	});

	test("status and status category", async () => {
		await expectKeys(`status = "Test Open"`, [A, D]);
		await expectKeys(`status in ("Test Done", "Test Progress")`, [B, C]);
		await expectKeys(`status != "Test Open"`, [B, C]);
		await expectKeys(`statusCategory = new`, [A, D]);
		await expectKeys(`statusCategory = "In Progress"`, [C]);
		await expectKeys(`statusCategory = Done`, [B]);
		await expectKeys(`Status = "Test Open"`, [A, D]);
		await expectKeys(`statusCategory = "To Do"`, [A, D]);
	});

	test("priority and resolution", async () => {
		await expectKeys(`priority = "Test High"`, [A]);
		await expectKeys(`priority is EMPTY`, [C, D]);
		await expectKeys(`resolution = "Test Fixed"`, [B]);
		await expectKeys(`resolution = Unresolved`, [A, C, D]);
		await expectKeys(`resolution != Unresolved`, [B]);
		await expectKeys(`resolution in (Unresolved, "Test Fixed")`, [A, B, C, D]);
	});

	test("people", async () => {
		await expectKeys(`assignee = "${username("alice")}"`, [A]);
		await expectKeys(`assignee = "Alice Tester"`, [A]);
		await expectKeys(`assignee = EMPTY`, [C, D]);
		await expectKeys(`assignee != "${username("alice")}"`, [B]);
		await expectKeys(`reporter = "${username("alice")}"`, [A, B]);
		await expectKeys(`creator = "${username("alice")}"`, [A, B]);
		await expectKeys(`watcher = "${username("alice")}"`, [B]);
		await expectKeys(`watcher = "${username("bob")}"`, [A]);
		await expectKeys(`assignee = currentUser()`, [A]);
		await expectKeys(`assignee in membersOf("${tag}-team")`, [A, B]);
	});

	test("text fields", async () => {
		await expectKeys(`summary = "Alpha widget fails"`, [A]);
		await expectKeys(`summary ~ widget`, [A]);
		await expectKeys(`summary ~ "alpha widget"`, [A]);
		await expectKeys(`summary !~ widget`, [B, C, D]);
		await expectKeys(`description ~ alpha`, [A]);
		await expectKeys(`description ~ outage`, [B]);
		await expectKeys(`comment ~ special`, [B]);
		await expectKeys(`comment ~ note`, [A]);
		await expectKeys(`text ~ widget`, [A]);
		await expectKeys(`text ~ outage`, [B]);
		await expectKeys(`text ~ note`, [A]);
		await expectKeys(`text ~ "Gamma subtask"`, [C]);
	});

	test("labels, components, versions", async () => {
		await expectKeys(`labels = red`, [A, C]);
		await expectKeys(`labels in (green)`, [B]);
		await expectKeys(`labels is EMPTY`, [D]);
		await expectKeys(`labels is not EMPTY`, [A, B, C]);
		await expectKeys(`labels != red`, [B]);
		await expectKeys(`component = "Test Comp"`, [A]);
		await expectKeys(`component is EMPTY`, [B, C, D]);
		await expectKeys(`fixVersion = "Test 1.0"`, [A]);
		await expectKeys(`fixVersion = "Test 2.0"`, [B]);
		await expectKeys(`fixVersion in releasedVersions()`, [A]);
		await expectKeys(`fixVersion in unreleasedVersions()`, [B]);
		await expectKeys(`affectedVersion = "Test 2.0"`, [B]);
	});

	test("key, id, parent, epic link and links", async () => {
		await expectKeys(`key = ${B}`, [B]);
		await expectKeys(`key >= ${KEY}-2`, [B, C, D]);
		await expectKeys(`key < ${KEY}-3`, [A, B]);
		await expectKeys(`key in (${A}, ${C})`, [A, C]);
		await expectKeys(`issuekey = ${A}`, [A]);
		await expectKeys(`id = 900000003`, [C]);
		await expectKeys(`id > 900000001`, [B, C, D]);
		await expectKeys(`parent = ${A}`, [C]);
		await expectKeys(`parent is EMPTY`, [A, B, D]);
		await expectKeys(`"Epic Link" = ${B}`, [C]);
		await expectKeys(`"Epic Link" is EMPTY`, [A, B, D]);
		await expectKeys(`issueLinkType = "Test Relates"`, [A, B]);
		await expectKeys(`issueLinkType != "Test Relates"`, [C, D]);
		await expectKeys(`issue in linkedIssues(${A})`, [B]);
		await expectKeys(`issue in linkedIssues(${A}, "Test Relates")`, [B]);
	});

	test("dates, numbers and durations", async () => {
		await expectKeys(`created >= -10d`, [A, C]);
		await expectKeys(`created < -10d`, [B, D]);
		await expectKeys(`created >= "2026-06-01"`, [A, C]);
		await expectKeys(`duedate >= "2026-06-15"`, [A]);
		await expectKeys(`resolutiondate is EMPTY`, [A, C, D]);
		await expectKeys(`created <= "2026/05/31"`, [B, D]);
		await expectKeys(`updated >= -2d`, [A, B]);
		await expectKeys(`resolved >= -7d`, [B]);
		await expectKeys(`resolved is EMPTY`, [A, C, D]);
		await expectKeys(`due <= 24h`, [A, B]);
		await expectKeys(`storyPoints > 3`, [A]);
		await expectKeys(`storyPoints = 5`, [A]);
		await expectKeys(`storyPoints is EMPTY`, [B, C, D]);
		await expectKeys(`originalEstimate >= "30m"`, [A]);
		await expectKeys(`remainingEstimate <= "1h"`, [A]);
		await expectKeys(`timeSpent > "5m"`, [A]);
	});

	test("date functions use the fixed now", async () => {
		await expectKeys(`created >= startOfMonth(-1)`, [A, B, C, D]);
		await expectKeys(`created <= endOfMonth(-1)`, [B, D]);
		await expectKeys(`created >= startOfYear()`, [A, B, C, D]);
		await expectKeys(`created < startOfDay(-10)`, [B, D]);
		await expectKeys(`created >= now()`, []);
		await expectKeys(`created <= now()`, [A, B, C, D]);
		await expectKeys(`created >= startOfWeek(-1)`, [C]);
		await expectKeys(`created <= endOfDay(-1)`, [A, B, C, D]);
		await expectKeys(`created <= endOfMonth()`, [A, B, C, D]);
		await expectKeys(`created <= endOfYear(-1)`, []);
		await expectKeys(`created >= startOfYear(0)`, [A, B, C, D]);
	});

	test("issue type functions", async () => {
		await expectKeys(`issuetype in subTaskIssueTypes()`, [C]);
		await expectKeys(`issuetype in standardIssueTypes()`, [A, B, D]);
	});

	test("sprints", async () => {
		await expectKeys(`sprint = "Test Sprint Open"`, [A]);
		await expectKeys(`sprint in openSprints()`, [A]);
		await expectKeys(`sprint in closedSprints()`, [C]);
		await expectKeys(`sprint in futureSprints()`, [B]);
		await expectKeys(`sprint is EMPTY`, [D]);
	});

	test("custom fields by name and id", async () => {
		await expectKeys(`"Test Text" = hello`, [A]);
		await expectKeys(`cf[99001] = hello`, [A]);
		await expectKeys(`"Test Text" ~ ell`, [A]);
		await expectKeys(`"Test Text" is EMPTY`, [B, C, D]);
		await expectKeys(`"Test Number" > 40`, [A]);
		await expectKeys(`CF[99002] = 42`, [A]);
		await expectKeys(`cf[99002] = 42`, [A]);
		await expectKeys(`"Test Select" = Alpha`, [A]);
		await expectKeys(`"Test Select" = Beta`, []);
		await expectKeys(`"Test Cascade" = Parent`, [A]);
		await expectKeys(`"Test Cascade" = Child`, [A]);
		await expectKeys(`"Test User" = "${username("alice")}"`, [A]);
		await expectKeys(`"Test Date" >= -30d`, [A]);
		await expectKeys(`"Test Date" < -20d`, []);
	});

	test("unknown fields and values raise Jira errors", async () => {
		await expectError(
			`nosuchfield = 1`,
			"Field 'nosuchfield' does not exist or you do not have permission to view it.",
		);
		await expectError(
			`cf[123456] = 1`,
			"Field 'cf[123456]' does not exist or you do not have permission to view it.",
		);
		await expectError(
			`status = "No Such Status"`,
			`The value 'No Such Status' does not exist for the field 'status'.`,
		);
		await expectError(
			`project = NOSUCH`,
			"The value 'NOSUCH' does not exist for the field 'project'.",
		);
		await expectError(
			`assignee = nobody`,
			"The value 'nobody' does not exist for the field 'assignee'.",
		);
		await expectError(
			`"Test Select" = Gamma`,
			`The value 'Gamma' does not exist for the field 'Test Select'.`,
		);
		await expectError(
			`created ~ foo`,
			"The operator '~' is not supported by the field 'created'.",
		);
		await expectError(
			`text ~ foo ORDER BY comment`,
			"Field 'comment' cannot be sorted on.",
		);
		await expectError(
			`"Time to resolution" = 1`,
			"Field 'Time to resolution' can only be used in ORDER BY.",
		);
	});

	test("ORDER BY sorts with a stable tie-break", async () => {
		expect(await keys(`project = ${KEY} ORDER BY created ASC`)).toEqual([
			D,
			B,
			A,
			C,
		]);
		expect(await keys(`project = ${KEY} ORDER BY created DESC`)).toEqual([
			C,
			A,
			B,
			D,
		]);
		expect(await keys(`project = ${KEY} ORDER BY Rank ASC`)).toEqual([
			A,
			B,
			C,
			D,
		]);
		expect(await keys(`project = ${KEY} ORDER BY summary ASC`)).toEqual([
			A,
			B,
			D,
			C,
		]);
		expect(await keys(`project = ${KEY} ORDER BY "Story Points" DESC`)).toEqual(
			[A, C, B, D],
		);
		expect(
			await keys(`project = ${KEY} ORDER BY "Time to resolution" ASC`),
		).toEqual([D, B, A, C]);
	});

	test("history operators", async () => {
		await expectKeys(`status was "Test Progress"`, [A, C]);
		await expectKeys(`status was "Test Open"`, [A, D]);
		await expectKeys(`status was not "Test Done"`, [A, C, D]);
		await expectKeys(`status was in ("Test Progress", "Test Done")`, [A, B, C]);
		await expectKeys(`status was not in ("Test Open")`, [B, C]);
		await expectKeys(`status changed`, [A]);
		await expectKeys(`status changed from "Test Open"`, [A]);
		await expectKeys(`status changed to "Test Progress"`, [A]);
		await expectKeys(`status changed to "Test Done"`, []);
		await expectKeys(`status changed by "${username("bob")}"`, [A]);
		await expectKeys(`status changed after -2d`, [A]);
		await expectKeys(`status changed before -2d`, [A]);
		await expectKeys(`status changed during (-7d, -2d)`, [A]);
		await expectKeys(`status changed on "2026-06-09"`, [A]);
		await expectKeys(`assignee changed to "${username("bob")}"`, [A]);
		await expectKeys(`assignee was "${username("bob")}"`, [A, B]);
		await expectKeys(`priority was "Test High"`, [A]);
		await expectKeys(`resolution was Unresolved`, [A, C, D]);
		await expectKeys(`reporter was "${username("alice")}"`, [A, B]);
		await expectKeys(`fixVersion was "Test 1.0"`, [A]);
		await expectKeys(`issuekey in updatedBy("${username("alice")}")`, [A]);
		await expectKeys(
			`issuekey in updatedBy("${username("alice")}", -7d, -5d)`,
			[A],
		);
		await expectKeys(`issuekey in updatedBy("${username("alice")}", -3d)`, []);
		await expectError(
			`labels was red`,
			"Field 'labels' does not support history searches.",
		);
	});
});

describe("JQL compiler: SQL injection stays data", () => {
	const payload = "'); DROP TABLE issues;--";

	test("value payloads are parameterised", async () => {
		await expectKeys(`summary = "${payload}"`, []);
		await expectKeys(`summary ~ "${payload}"`, []);
		await expectKeys(`cf[99001] = "${payload}"`, []);
		await expectKeys(`labels = "${payload}"`, []);
		await expectKeys(`comment ~ "${payload}"`, []);

		const result = await pool.query(
			"select count(*)::int as count from issues",
		);
		expect(result.rows[0].count).toBeGreaterThan(0);
	});

	test("field name payloads are rejected before reaching SQL", async () => {
		await expectError(
			`"${payload}" = 1`,
			`Field '${payload}' does not exist or you do not have permission to view it.`,
		);
		await expectError(
			`project = "${payload}"`,
			`The value '${payload}' does not exist for the field 'project'.`,
		);
		await expectError(
			`project = ${KEY} ORDER BY "${payload}"`,
			`Field '${payload}' does not exist or you do not have permission to view it.`,
		);
	});
});

describe("JQL search results", () => {
	test("returns the requested columns", async () => {
		const result = await searchIssues(
			{ jql: `key = ${A}`, startAt: 0, maxResults: 10 },
			alice(),
			{ now: NOW },
		);
		expect(result.total).toBe(1);
		const [issue] = result.issues;
		expect(issue).toEqual({
			key: A,
			summary: "Alpha widget fails",
			type: "Test Bug",
			status: "Test Open",
			priority: "Test High",
			assignee: { username: username("alice"), displayName: "Alice Tester" },
			reporter: { username: username("alice"), displayName: "Alice Tester" },
			resolution: null,
			created: days(-10).toISOString(),
			updated: days(-2).toISOString(),
			storyPoints: 5,
			labels: ["blue", "red"],
		});
	});

	test("startAt and maxResults paginate", async () => {
		const first = await searchIssues(
			{ jql: `project = ${KEY} ORDER BY key ASC`, startAt: 0, maxResults: 2 },
			alice(),
			{ now: NOW },
		);
		expect(first.total).toBe(4);
		expect(first.issues.map((issue) => issue.key)).toEqual([A, B]);

		const second = await searchIssues(
			{ jql: `project = ${KEY} ORDER BY key ASC`, startAt: 2, maxResults: 2 },
			alice(),
			{ now: NOW },
		);
		expect(second.total).toBe(4);
		expect(second.issues.map((issue) => issue.key)).toEqual([C, D]);
	});

	test("default order is created descending", async () => {
		const result = await searchIssues(
			{ jql: `project = ${KEY}`, startAt: 0, maxResults: 10 },
			alice(),
			{ now: NOW },
		);
		expect(result.issues.map((issue) => issue.key)).toEqual([C, A, B, D]);
	});
});
