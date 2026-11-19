import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	boards,
	components,
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
	expect(visibleResult.json().total).toBe(1);

	const invisibleResult = await search(`project = ${invisibleKey}`);
	expect(invisibleResult.statusCode).toBe(200);
	expect(invisibleResult.json().total).toBe(0);
	expect(invisibleResult.json().issues).toEqual([]);

	const mixed = await search(
		`project in (${visibleKey}, ${invisibleKey}) ORDER BY key ASC`,
	);
	expect(mixed.statusCode).toBe(200);
	expect(mixed.json().total).toBe(1);
	expect(mixed.json().issues[0].key).toBe(visible.issueKeys[0]);

	const text = await search(`text ~ "${secretSummary}"`);
	expect(text.statusCode).toBe(200);
	expect(text.json().total).toBe(0);
});

test("function sub-queries cannot reveal invisible issues", async () => {
	const linked = await search(
		`issue in linkedIssues(${invisible.issueKeys[0]})`,
	);
	expect(linked.statusCode).toBe(400);
	expect(JSON.stringify(linked.json())).not.toContain(secretSummary);

	const history = await search(`issue in updatedBy("${invisibleUser}")`);
	expect(history.statusCode).toBe(200);
	expect(history.json().total).toBe(0);

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
