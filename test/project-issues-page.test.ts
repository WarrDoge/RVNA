import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { listProjectIssues } from "../src/lib/server/projects/service.ts";
import { load } from "../src/routes/projects/[key]/issues/+page.server.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	type SeedResult,
} from "./fixtures/project.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const hiddenRun = `${run}hidden`;
const hiddenKey = `PH${run.slice(0, 5).toUpperCase()}`;
const hiddenScheme = `test:${run}:project-issues-hidden`;
const visibleRun = `${run}visible`;
const visibleKey = `PV${run.slice(0, 5).toUpperCase()}`;

let client: Client;
let actor: CurrentUser;
let hiddenProjectId: string;
let visible: SeedResult;

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const user = await makeUser(run, "project-issues");
	actor = {
		id: user.id,
		username: user.username,
		displayName: `Test project issues ${run}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};

	const hidden = await createProjectFixture(client, {
		run: hiddenRun,
		key: hiddenKey,
		name: `Project issues hidden ${run}`,
		issues: [{ summary: `Hidden project issue ${run}` }],
	});
	hiddenProjectId = hidden.projectId;
	await client.query(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb)`,
		[
			hiddenScheme,
			`Project issues hidden scheme ${run}`,
			JSON.stringify([hiddenProjectId]),
		],
	);

	visible = await createProjectFixture(client, {
		run: visibleRun,
		key: visibleKey,
		name: `Project issues visible ${run}`,
		issues: [{ summary: `Visible project issue ${run}` }],
		members: [actor.username],
	});
});

afterAll(async () => {
	if (client) {
		await client.query("delete from permission_schemes where source_id = $1", [
			hiddenScheme,
		]);
		await dropProjectFixture(client, hiddenRun);
		await dropProjectFixture(client, visibleRun);
		await cleanupTestData(run);
		await client.end();
	}
	await pool.end();
});

function event(key: string) {
	return {
		locals: { user: actor },
		params: { key },
		route: { id: "/projects/[key]/issues" },
		url: new URL(`http://localhost/projects/${key}/issues`),
		depends: () => undefined,
	} as never;
}

test("a hidden project is a 404 from the page load, not a 200 not-found result", async () => {
	await expect(load(event(hiddenKey))).rejects.toMatchObject({
		status: 404,
	});
});

test("the page and its total come from one snapshot", async () => {
	const count = await client.query<{ total: number }>(
		"select count(*)::int as total from issues where project_id = $1",
		[visible.projectId],
	);
	const before = count.rows[0]?.total ?? 0;
	const insertedKey = `${visibleKey}-9001`;
	const original = pool.query.bind(pool);
	let raced = false;
	(pool as unknown as { query: typeof pool.query }).query = ((
		query: { text?: string } | string,
		...rest: unknown[]
	) => {
		const text = typeof query === "string" ? query : (query.text ?? "");
		if (
			!raced &&
			text.includes("count(*)::int") &&
			text.includes('from "issues"')
		) {
			raced = true;
			return client
				.query(
					`insert into issues
					 (source_id, project_id, number, key, type_id, status_id, summary, created, updated)
					 values ($1, $2, 9001, $3, $4, $5, $6, now(), now())`,
					[
						`test:${run}:snapshot-issue`,
						visible.projectId,
						insertedKey,
						visible.typeIds.task,
						visible.statusIds.todo,
						`Snapshot issue ${run}`,
					],
				)
				.then(() =>
					(original as (...args: unknown[]) => unknown)(query, ...rest),
				);
		}
		return (original as (...args: unknown[]) => unknown)(query, ...rest);
	}) as typeof pool.query;
	try {
		const result = await listProjectIssues(actor, visibleKey, {
			offset: 0,
			limit: 50,
		});
		expect(result.issues).toHaveLength(before);
		expect(result.total).toBe(before);
	} finally {
		(pool as unknown as { query: typeof pool.query }).query = original;
		await client.query("delete from issues where key = $1", [insertedKey]);
	}
});
