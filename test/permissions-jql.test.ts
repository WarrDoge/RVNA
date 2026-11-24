import { eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	boards,
	components,
	groups,
	issueSprints,
	permissionGrants,
	permissionSchemes,
	sprints,
	users,
	versions,
} from "../src/lib/server/schema.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
	type SeedResult,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = fixtureRun();
const visibleKey = fixtureKey(run);
const invisibleKey = `QQ${run.slice(0, 5).toUpperCase()}`;
const visibleUser = `t-${run}-jql`;
const invisibleUser = `t-${run}-hidden`;
const strangerUser = `t-${run}-stranger`;
const hiddenGroup = `t-${run}-hidden-group`;
const sharedGroup = `t-${run}-shared-group`;
const missingKey = `ZZ${run.slice(0, 5).toUpperCase()}`;
const visibleLabel = `visible-label-${run}`;
const secretLabel = `secret-label-${run}`;
const visibleVersion = `Visible version ${run}`;
const secretVersion = `Secret version ${run}`;
const visibleComponent = `Visible component ${run}`;
const secretComponent = `Secret component ${run}`;
const visibleSprint = `Visible Sprint ${run}`;
const secretSprint = `Secret Sprint ${run}`;
const secretSummary = `Invisible JQL issue ${run}`;

let app: TestApp;
let client: Client;
let session: string;
let visible: SeedResult;
let invisible: SeedResult;
let userId: string;
let hiddenUserId: string;

async function grantBrowse(
	schemeSourceId: string,
	projectId: string,
	holderType: "user" | "group",
	parameter: string,
) {
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: schemeSourceId,
			name: schemeSourceId,
			projectIds: [projectId],
			raw: {},
		})
		.returning();
	await db.insert(permissionGrants).values({
		sourceId: `${schemeSourceId}:browse`,
		schemeId: scheme.id,
		permissionKey: "BROWSE_PROJECTS",
		holderType,
		holderParameter: parameter,
		raw: {},
	});
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const loggedIn = await login(app, {
		sub: `${run}-jql`,
		username: visibleUser,
		name: "JQL Visible",
		groups: [],
	});
	session = loggedIn.sessionId as string;
	const rows = await pool.query<{ id: string }>(
		"select id from users where username = $1",
		[visibleUser],
	);
	userId = rows.rows[0].id;
	const [hidden] = await db
		.insert(users)
		.values({
			username: invisibleUser,
			displayName: "Hidden User",
			active: false,
		})
		.returning();
	hiddenUserId = hidden.id;

	visible = await createProjectFixture(client, {
		run: `${run}vis`,
		key: visibleKey,
		name: `Visible JQL ${run}`,
		issues: [
			{
				summary: `Visible JQL issue ${run}`,
				labels: [visibleLabel],
				assigneeId: userId,
				reporterId: userId,
			},
			{
				summary: `Left colleague issue ${run}`,
				assigneeId: hiddenUserId,
				reporterId: userId,
			},
		],
	});
	invisible = await createProjectFixture(client, {
		run: `${run}inv`,
		key: invisibleKey,
		name: `Invisible JQL ${run}`,
		issues: [
			{
				summary: secretSummary,
				labels: [secretLabel],
				assigneeId: hiddenUserId,
				reporterId: hiddenUserId,
			},
		],
	});

	await grantBrowse(
		`${run}:visible-scheme`,
		visible.projectId,
		"user",
		visibleUser,
	);
	await db.insert(users).values({
		username: strangerUser,
		displayName: `Stranger ${run}`,
	});
	await db
		.insert(groups)
		.values([{ name: hiddenGroup }, { name: sharedGroup }]);
	const [visibleScheme] = await db
		.select({ id: permissionSchemes.id })
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, `${run}:visible-scheme`));
	await db.insert(permissionGrants).values({
		sourceId: `${run}:visible-scheme:browse-group`,
		schemeId: visibleScheme.id,
		permissionKey: "BROWSE_PROJECTS",
		holderType: "group",
		holderParameter: sharedGroup,
		raw: {},
	});
	await grantBrowse(
		`${run}:invisible-scheme`,
		invisible.projectId,
		"group",
		`${run}-nobody`,
	);

	await db.insert(versions).values([
		{
			sourceId: `${run}:visible-version`,
			projectId: visible.projectId,
			name: visibleVersion,
		},
		{
			sourceId: `${run}:secret-version`,
			projectId: invisible.projectId,
			name: secretVersion,
		},
	]);
	await db.insert(components).values([
		{
			sourceId: `${run}:visible-component`,
			projectId: visible.projectId,
			name: visibleComponent,
		},
		{
			sourceId: `${run}:secret-component`,
			projectId: invisible.projectId,
			name: secretComponent,
		},
	]);

	for (const [index, [name, project, tag]] of (
		[
			[visibleSprint, visible, "visible"],
			[secretSprint, invisible, "secret"],
		] as const
	).entries()) {
		const [board] = await db
			.insert(boards)
			.values({
				rapidViewId: 800000 + Number.parseInt(run.slice(0, 5), 16) * 2 + index,
				sourceId: `${run}:${tag}-board`,
				name: `Board ${tag} ${run}`,
				type: "scrum",
				filterJql: `project = ${project.projectKey}`,
				projectId: project.projectId,
			})
			.returning();
		const [sprint] = await db
			.insert(sprints)
			.values({
				sourceId: `${run}:${tag}-sprint`,
				boardId: board.id,
				name,
				state: "active",
			})
			.returning();
		await db.insert(issueSprints).values({
			issueId: project.issueIds[0] as string,
			sprintId: sprint.id,
			isOpen: true,
		});
	}
});

afterAll(async () => {
	if (client) {
		await client.query(
			"delete from permission_grants where scheme_id in (select id from permission_schemes where source_id like $1)",
			[`${run}:%`],
		);
		await client.query(
			"delete from permission_schemes where source_id like $1",
			[`${run}:%`],
		);
		await client.query("delete from boards where source_id like $1", [
			`${run}:%`,
		]);
		await dropProjectFixture(client, `${run}vis`);
		await dropProjectFixture(client, `${run}inv`);
		await client.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function search(jql: string) {
	return app.inject({
		method: "GET",
		url: `/api/search?jql=${encodeURIComponent(jql)}&maxResults=50`,
		cookies: { sid: session },
	});
}

function suggest(field: string, prefix = "") {
	return app.inject({
		method: "GET",
		url: `/api/jql/suggest?field=${encodeURIComponent(field)}&prefix=${encodeURIComponent(prefix)}&limit=50`,
		cookies: { sid: session },
	});
}

test("search only returns issues from visible projects", async () => {
	const visibleResult = await search(`project = ${visibleKey}`);
	expect(visibleResult.statusCode).toBe(200);
	expect(visibleResult.json().total).toBe(2);

	const ordered = await search(`project = ${visibleKey} ORDER BY key ASC`);
	expect(ordered.statusCode).toBe(200);
	expect(ordered.json().issues[0].key).toBe(visible.issueKeys[0]);

	const text = await search(`text ~ "${secretSummary}"`);
	expect(text.statusCode).toBe(200);
	expect(text.json().total).toBe(0);
});

/** The answer of a query with the name it quotes replaced, so two names compare alike. */
async function answer(jql: (name: string) => string, name: string) {
	const response = await search(jql(name));
	return {
		status: response.statusCode,
		body: response.body.split(name).join("<name>"),
	};
}

test.each([
	[
		"project key",
		invisibleKey,
		missingKey,
		(name: string) => `project = ${name}`,
	],
	[
		"project key in a list",
		invisibleKey,
		missingKey,
		(name: string) => `project in (${visibleKey}, ${name})`,
	],
	[
		"project name",
		`Invisible JQL ${run}`,
		`Missing JQL ${run}`,
		(name: string) => `project = "${name}"`,
	],
	[
		"issue key range",
		`${invisibleKey}-1`,
		`${missingKey}-1`,
		(name: string) => `key > ${name}`,
	],
	[
		"version",
		secretVersion,
		`Missing version ${run}`,
		(name: string) => `fixVersion = "${name}"`,
	],
	[
		"component",
		secretComponent,
		`Missing component ${run}`,
		(name: string) => `component = "${name}"`,
	],
	[
		"sprint",
		secretSprint,
		`Missing Sprint ${run}`,
		(name: string) => `sprint = "${name}"`,
	],
	[
		"user name",
		strangerUser,
		`t-${run}-nobody`,
		(name: string) => `assignee = "${name}"`,
	],
	[
		"user display name",
		`Stranger ${run}`,
		`Nobody ${run}`,
		(name: string) => `reporter = "${name}"`,
	],
	[
		"user in a function",
		strangerUser,
		`t-${run}-nobody`,
		(name: string) => `issue in updatedBy("${name}")`,
	],
	[
		"group",
		hiddenGroup,
		`t-${run}-no-group`,
		(name: string) => `assignee in membersOf("${name}")`,
	],
])(
	"a hidden %s answers like one that does not exist",
	async (_label, hidden, missing, jql) => {
		const hiddenAnswer = await answer(jql, hidden);
		const missingAnswer = await answer(jql, missing);
		expect(missingAnswer.status).toBe(400);
		expect(hiddenAnswer).toEqual(missingAnswer);
	},
);

test("a board filter is checked with the same rule when it is saved", async () => {
	const create = async (name: string) => {
		const response = await app.inject({
			method: "POST",
			url: "/api/boards",
			cookies: { sid: session },
			headers: { "x-requested-with": "rvna" },
			payload: {
				name: `Probe ${run}`,
				type: "kanban",
				filterJql: `project = ${name}`,
				project: visibleKey,
			},
		});
		return {
			status: response.statusCode,
			body: response.body.split(name).join("<name>"),
		};
	};
	const hidden = await create(invisibleKey);
	const missing = await create(missingKey);
	expect(missing.status).toBe(400);
	expect(hidden).toEqual(missing);
});

test("an inactive user can be named and only the issues the viewer may browse come back", async () => {
	const left = await search(`assignee = "${invisibleUser}"`);
	expect(left.statusCode).toBe(200);
	expect(left.json().issues.map((issue: { key: string }) => issue.key)).toEqual(
		[visible.issueKeys[1]],
	);
	expect(left.body).not.toContain(secretSummary);

	const byName = await search(
		`reporter = "Hidden User" OR assignee = "Hidden User"`,
	);
	expect(byName.json().total).toBe(1);

	const missing = await answer(
		(name) => `assignee = "${name}"`,
		`t-${run}-never-existed`,
	);
	expect(missing.status).toBe(400);
});

test("names the viewer may see still resolve", async () => {
	for (const jql of [
		`project = "${`Visible JQL ${run}`}"`,
		`key > ${visibleKey}-0`,
		`fixVersion = "${visibleVersion}"`,
		`component = "${visibleComponent}"`,
		`sprint = "${visibleSprint}"`,
		`assignee = "${visibleUser}"`,
		`assignee = currentUser()`,
		`assignee in membersOf("${sharedGroup}")`,
	]) {
		const response = await search(jql);
		expect(response.statusCode, jql).toBe(200);
	}
});

test("function sub-queries cannot reveal invisible issues", async () => {
	const linked = await search(
		`issue in linkedIssues(${invisible.issueKeys[0]})`,
	);
	expect(linked.statusCode).toBe(400);
	expect(JSON.stringify(linked.json())).not.toContain(secretSummary);

	const current = await search("assignee = currentUser()");
	expect(current.statusCode).toBe(200);
	expect(current.json().total).toBe(1);
});

test("suggestions hide invisible project, user, label, version, component and sprint names", async () => {
	const projects = (await suggest("project", invisibleKey.slice(0, 4))).json()
		.values as string[];
	expect(projects).not.toContain(invisibleKey);

	const users = (await suggest("assignee", invisibleUser)).json()
		.values as string[];
	expect(users).not.toContain(invisibleUser);

	const labels = (await suggest("labels", secretLabel.slice(0, 6))).json()
		.values as string[];
	expect(labels).not.toContain(secretLabel);

	const versions = (
		await suggest("fixVersion", secretVersion.slice(0, 6))
	).json().values as string[];
	expect(versions).not.toContain(secretVersion);

	const components = (
		await suggest("component", secretComponent.slice(0, 6))
	).json().values as string[];
	expect(components).not.toContain(secretComponent);

	const sprints = (await suggest("sprint", "Secret Sprint")).json()
		.values as string[];
	expect(sprints).not.toContain(secretSprint);

	const visibleLabels = (
		await suggest("labels", visibleLabel.slice(0, 6))
	).json().values as string[];
	expect(visibleLabels).toContain(visibleLabel);
	const visibleVersions = (
		await suggest("fixVersion", "Visible version")
	).json().values as string[];
	expect(visibleVersions).toContain(visibleVersion);
	const visibleComponents = (
		await suggest("component", "Visible component")
	).json().values as string[];
	expect(visibleComponents).toContain(visibleComponent);
	const visibleSprints = (await suggest("sprint", "Visible Sprint")).json()
		.values as string[];
	expect(visibleSprints).toContain(visibleSprint);
});
