import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { userForSession } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { loadCatalog } from "../src/lib/server/jql/catalog.ts";
import * as suggestModule from "../src/lib/server/jql/suggest.ts";
import { runWithRequestCache } from "../src/lib/server/request-context.ts";
import {
	boards,
	fieldOptions,
	fields,
	sprints,
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
const key = fixtureKey(run);
let app: TestApp;
let client: Client;
let session: string;
let fixture: SeedResult;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const loggedIn = await login(app, {
		sub: `sub-${run}`,
		username: `t-${run}-suggest`,
		name: "Suggest User",
		groups: [],
	});
	session = loggedIn.sessionId as string;

	fixture = await createProjectFixture(client, {
		run,
		key,
		issues: [
			{ summary: "Zephyr one", labels: ["alpha", "beta"] },
			{ summary: "Zephyr two", labels: ["gamma"] },
		],
	});

	const customFields = await db
		.insert(fields)
		.values([
			{
				sourceId: `customfield_9${run}sprint`,
				name: `Sprint field ${run}`,
				type: "array",
				customKey: "com.example:gh-sprint",
			},
			{
				sourceId: `customfield_9${run}participants`,
				name: `Participants field ${run}`,
				type: "array",
				customKey: "com.example:sd-request-participants",
			},
			{
				sourceId: `customfield_9${run}user`,
				name: `User field ${run}`,
				type: "array",
				customKey: "com.example:multiuserpicker",
			},
		])
		.returning();
	const userField = customFields.find((field) =>
		field.sourceId.endsWith("user"),
	);
	if (!userField) throw new Error("the user field was not created");
	await db.insert(fieldOptions).values({
		sourceId: `${run}-user-option`,
		fieldId: userField.id,
		value: `Suggest Option ${run}`,
	});

	const [board] = await db
		.insert(boards)
		.values({
			rapidViewId: 1_000_000 + Number.parseInt(run.slice(0, 6), 16),
			sourceId: `fixture:${run}:suggest-board`,
			name: `Suggest board ${run}`,
			type: "scrum",
			filterJql: `project = ${key}`,
			projectId: fixture.projectId,
		})
		.returning();
	if (!board) throw new Error("the suggestion board was not created");
	await db.insert(sprints).values({
		sourceId: `fixture:${run}:suggest-sprint`,
		boardId: board.id,
		name: `Suggest Sprint ${run}`,
		state: "active",
		sequence: 1,
	});
});

afterAll(async () => {
	if (client) {
		await pool.query("delete from boards where source_id = $1", [
			`fixture:${run}:suggest-board`,
		]);
		await pool.query("delete from fields where source_id like $1", [
			`customfield_9${run}%`,
		]);
		await dropProjectFixture(client, run);
		await client.end();
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function suggest(field: string, prefix = "") {
	return app.inject({
		method: "GET",
		url: `/api/jql/suggest?field=${encodeURIComponent(field)}&prefix=${encodeURIComponent(prefix)}`,
		cookies: { sid: session },
	});
}

test("project values are keys and names", async () => {
	const response = await suggest("project", key.slice(0, 4));
	expect(response.statusCode).toBe(200);
	expect(response.json().values).toContain(key);
});

test("status, priority and resolution values come from the catalog", async () => {
	expect((await suggest("status", "To")).json().values).toContain("To Do");
	expect((await suggest("status", "In Prog")).json().values).toContain(
		"In Progress",
	);
	expect((await suggest("priority", "h")).json().values).toContain("High");
	expect((await suggest("issuetype", "bu")).json().values).toContain("Bug");
	expect((await suggest("resolution", "Unr")).json().values).toEqual([
		"Unresolved",
	]);
});

test("user fields suggest usernames", async () => {
	const values = (await suggest("assignee", `t-${run}`)).json().values;
	expect(values).toContain(`t-${run}-suggest`);
});

test("custom user fields suggest users by username or display name", async () => {
	for (const field of [`User field ${run}`, `Participants field ${run}`]) {
		const values = (await suggest(field, "Suggest")).json().values;
		expect(values).toContain(`t-${run}-suggest`);
		expect(values).not.toContain(`Suggest Option ${run}`);
	}
});

test("a custom sprint field suggests sprint names", async () => {
	const values = (await suggest(`Sprint field ${run}`, "Suggest")).json()
		.values;
	expect(values).toContain(`Suggest Sprint ${run}`);
});

test("labels and issue keys are suggested", async () => {
	const labels = (await suggest("labels", "al")).json().values;
	expect(labels).toContain("alpha");

	const keys = (await suggest("epicLink", key)).json().values;
	expect(keys).toEqual(expect.arrayContaining(fixture.issueKeys));
});

test("an unknown field suggests nothing", async () => {
	expect((await suggest("notafield")).json().values).toEqual([]);
});

test("the prefix filters values", async () => {
	const values = (await suggest("status", "done")).json().values;
	expect(values).toEqual(["Done"]);
});

test("suggest requires a session", async () => {
	const response = await app.inject({
		method: "GET",
		url: "/api/jql/suggest?field=status",
	});
	expect(response.statusCode).toBe(401);
});

test("suggestValues is not exported without a viewer", () => {
	expect("suggestValues" in suggestModule).toBe(false);
});

test("suggest clamps a zero limit inside the function", async () => {
	const actor = await userForSession(session);
	if (!actor) throw new Error("The test session has no user");
	const result = await suggestModule.suggest(actor, {
		field: "status",
		prefix: "",
		limit: 0,
	});
	expect(result.values.length).toBeGreaterThan(0);
});

test("a field that needs no catalog does not read the catalog tables", async () => {
	const actor = await userForSession(session);
	if (!actor) throw new Error("The test session has no user");
	const database = db as unknown as { execute: typeof db.execute };
	const original = database.execute;
	let calls = 0;
	database.execute = ((query: Parameters<typeof db.execute>[0]) => {
		calls += 1;
		return original(query);
	}) as typeof db.execute;
	try {
		const result = await suggestModule.suggest(actor, {
			field: "statusCategory",
			prefix: "To",
			limit: 20,
		});
		expect(result.values).toEqual(["To Do"]);
	} finally {
		database.execute = original;
	}
	expect(calls).toBe(0);
});

test("the catalog is read once per request", async () => {
	const database = db as unknown as { execute: typeof db.execute };
	const original = database.execute;
	let calls = 0;
	database.execute = ((query: Parameters<typeof db.execute>[0]) => {
		calls += 1;
		return original(query);
	}) as typeof db.execute;
	try {
		await runWithRequestCache(async () => {
			await loadCatalog();
			await loadCatalog();
		});
	} finally {
		database.execute = original;
	}
	expect(calls).toBe(13);
});

test("the catalog starts every query before waiting for any of them", async () => {
	const database = db as unknown as { execute: typeof db.execute };
	const original = database.execute;
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	database.execute = ((query: Parameters<typeof db.execute>[0]) => {
		const text = JSON.stringify(
			(query as unknown as { queryChunks?: unknown }).queryChunks ?? "",
		);
		if (text.includes("board_sprints")) {
			release();
			return original(query);
		}
		return gate.then(() => original(query));
	}) as typeof db.execute;
	const loading = runWithRequestCache(() => loadCatalog());
	let timer: ReturnType<typeof setTimeout> | undefined;
	const outcome = await Promise.race([
		loading.then(() => "loaded" as const),
		new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), 500);
		}),
	]);
	if (timer) clearTimeout(timer);
	release();
	database.execute = original;
	await loading;
	expect(outcome).toBe("loaded");
});

test("label suggestions filter and limit in SQL", async () => {
	const actor = await userForSession(session);
	if (!actor) throw new Error("The test session has no user");
	const database = db as unknown as {
		transaction: (
			run: (tx: {
				execute: (query: unknown) => Promise<unknown>;
			}) => Promise<unknown>,
		) => Promise<unknown>;
	};
	const original = database.transaction;
	const queries: string[] = [];
	database.transaction = (run) =>
		original(async (tx) => {
			const execute = tx.execute;
			tx.execute = (query) => {
				queries.push(
					JSON.stringify(
						(query as unknown as { queryChunks?: unknown }).queryChunks ?? "",
					),
				);
				return execute.call(tx, query);
			};
			return run(tx);
		});
	try {
		const result = await suggestModule.suggest(actor, {
			field: "labels",
			prefix: "al",
			limit: 1,
		});
		expect(result.values).toEqual(["alpha"]);
	} finally {
		database.transaction = original;
	}
	const labelQuery = queries.find((query) => query.includes("issue_labels"));
	if (!labelQuery) throw new Error("the label query was not captured");
	expect(labelQuery).toContain("ilike");
	expect(labelQuery).toContain("escape '!'");
	expect(labelQuery).toContain("limit");
	expect(labelQuery).toContain("al%");
});
