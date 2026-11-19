import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { getNavigatorPreferences } from "../src/lib/server/navigator/service.ts";
import { load as issuesLoad } from "../src/routes/issues/+page.server.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
} from "./fixtures/project.ts";

const run = fixtureRun();
const key = fixtureKey(run);
const username = `t-${run}-navigator`;

let client: Client;
let viewer: CurrentUser;

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const viewerRow = await client.query<{ id: string }>(
		`insert into users (username, display_name) values ($1, $2) returning id`,
		[username, "Navigator reviewer"],
	);
	viewer = {
		id: viewerRow.rows[0]?.id as string,
		username,
		displayName: "Navigator reviewer",
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};

	await createProjectFixture(client, {
		run,
		key,
		issues: [
			{ summary: `Visible issue one ${run}` },
			{ summary: `Visible issue two ${run}` },
		],
	});
});

afterAll(async () => {
	if (client) {
		await dropProjectFixture(client, run);
		await client.end();
	}
	await pool.query("delete from users where username ilike $1", [`t-${run}-%`]);
	await pool.end();
});

function issueLoadEvent(filterId: string) {
	return {
		locals: { user: viewer },
		params: {},
		route: { id: "/issues" },
		url: new URL(`http://localhost/issues/?filter=${filterId}&view=list`),
		depends: () => undefined,
	} as never;
}

test("a filter's stale and duplicate columns are dropped before the navigator loads", async () => {
	const created = await client.query<{ id: string }>(
		`insert into filters (name, jql, owner_id, columns, shared, source_id)
		 values ($1, $2, $3, $4::jsonb, false, $5) returning id`,
		[
			`Stale columns filter ${run}`,
			`project = ${key} ORDER BY key ASC`,
			viewer.id,
			JSON.stringify(["key", "key", "cf:customfield_999999", "summary"]),
			`filter-columns-${run}`,
		],
	);
	const filterId = created.rows[0]?.id as string;

	const data = (await issuesLoad(issueLoadEvent(filterId))) as {
		columns: string[];
	};
	expect(data.columns).toEqual(["key", "summary"]);

	await client.query(`delete from filters where id = $1`, [filterId]);
});

test("a stale preference column is dropped when the preferences load", async () => {
	await client.query(
		`insert into user_preferences (user_id, navigator_view, columns)
		 values ($1, 'list', $2::jsonb)
		 on conflict (user_id) do update set columns = excluded.columns`,
		[viewer.id, JSON.stringify(["key", "cf:customfield_999999", "key"])],
	);
	const preferences = await getNavigatorPreferences(viewer);
	expect(preferences.columns).toEqual(["key"]);
	await client.query("delete from user_preferences where user_id = $1", [
		viewer.id,
	]);
});
