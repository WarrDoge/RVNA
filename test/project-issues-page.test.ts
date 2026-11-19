import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { load } from "../src/routes/projects/[key]/issues/+page.server.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
} from "./fixtures/project.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const hiddenRun = `${run}hidden`;
const hiddenKey = `PH${run.slice(0, 5).toUpperCase()}`;
const hiddenScheme = `test:${run}:project-issues-hidden`;

let client: Client;
let actor: CurrentUser;
let hiddenProjectId: string;

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
});

afterAll(async () => {
	if (client) {
		await client.query("delete from permission_schemes where source_id = $1", [
			hiddenScheme,
		]);
		await dropProjectFixture(client, hiddenRun);
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
