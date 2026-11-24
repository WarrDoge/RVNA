import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	permissionGrants,
	permissionSchemes,
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
const currentKey = fixtureKey(run);
const previousKey = `PV${run.slice(0, 5).toUpperCase()}`;
const unknownKey = `UQ${run.slice(0, 5).toUpperCase()}`;
const memberName = `t-${run}-member`;
const outsiderName = `t-${run}-outsider`;

let app: TestApp;
let client: Client;
let member: string;
let outsider: string;
let fixture: SeedResult;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	member = (
		await login(app, {
			sub: `${run}-m`,
			username: memberName,
			name: "Member",
			groups: [],
		})
	).sessionId as string;
	outsider = (
		await login(app, {
			sub: `${run}-o`,
			username: outsiderName,
			name: "Outsider",
			groups: [],
		})
	).sessionId as string;
	fixture = await createProjectFixture(client, {
		run,
		key: currentKey,
		issues: [{ summary: `Renamed project issue ${run}` }],
	});
	await client.query(
		"insert into project_previous_keys (project_id, key) values ($1, $2)",
		[fixture.projectId, previousKey],
	);
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `${run}:scheme`,
			name: `Renamed ${run}`,
			projectIds: [fixture.projectId],
			raw: {},
		})
		.returning();
	await db.insert(permissionGrants).values({
		sourceId: `${run}:scheme:browse`,
		schemeId: (scheme as { id: string }).id,
		permissionKey: "BROWSE_PROJECTS",
		holderType: "user",
		holderParameter: memberName,
		raw: {},
	});
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
		await dropProjectFixture(client, run);
		await client.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function get(session: string, url: string) {
	return app.inject({ method: "GET", url, cookies: { sid: session } });
}

/** What a visitor can tell apart: the status, where it points and, for the API, the body, without the key typed. */
async function answer(
	session: string,
	path: (key: string) => string,
	key: string,
) {
	const url = path(key);
	const response = await get(session, url);
	const location = response.headers.location ?? null;
	return {
		status: response.statusCode,
		location: location?.split(key).join("<key>") ?? null,
		body: url.startsWith("/api/")
			? response.body.split(key).join("<key>")
			: null,
		leaksCurrentKey: `${location}${response.body}`.includes(currentKey),
	};
}

const addresses: [string, (key: string) => string][] = [
	[
		"the project settings page",
		(key) => `/plugins/servlet/project-config/${key}/roles`,
	],
	[
		"the project summary page",
		(key) => `/plugins/servlet/project-config/${key}/summary`,
	],
	["the project address", (key) => `/projects/${key}/summary`],
	["the browse address", (key) => `/browse/${key}`],
	["an issue address", (key) => `/browse/${key}-1`],
	["the issues page", (key) => `/projects/${key}/issues`],
	["an issue in the API", (key) => `/api/issues/${key}-1`],
	["a project in the API", (key) => `/api/projects/${key}`],
];

test.each(addresses)(
	"a previous key answers an outsider like an unknown key: %s",
	async (_label, path) => {
		const previous = await answer(outsider, path, previousKey);
		const unknown = await answer(outsider, path, unknownKey);
		expect(previous).toEqual(unknown);
		expect(previous.leaksCurrentKey).toBe(false);
	},
);

test("a previous key still redirects a viewer who may browse the project", async () => {
	for (const [path, expected] of [
		[
			`/plugins/servlet/project-config/${previousKey}/roles`,
			`/plugins/servlet/project-config/${currentKey}/roles`,
		],
		[`/projects/${previousKey}/summary`, `/projects/${currentKey}/summary`],
		[`/browse/${previousKey}-1`, `/browse/${currentKey}-1`],
	] as const) {
		const response = await get(member, path);
		expect(response.statusCode, path).toBe(302);
		expect(response.headers.location, path).toBe(expected);
	}
});
