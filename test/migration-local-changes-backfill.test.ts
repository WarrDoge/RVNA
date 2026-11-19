import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	type SeedResult,
} from "./fixtures/project.ts";

const run = randomUUID().slice(0, 8);
const migration = readFileSync(
	resolve("drizzle/0024_local_changes_backfill.sql"),
	"utf8",
);
let client: Client;
let project: SeedResult;
let spaceId: string;
const pageIds: Record<string, string> = {};

async function page(name: string, versions: string[]) {
	const {
		rows: [row],
	} = await pool.query<{ id: string }>(
		`insert into pages (source_id, space_id, title, type, status, created, updated)
		 values ($1, $2, $3, 'page', 'current', now(), now()) returning id`,
		[`${run}:${name}`, spaceId, `${run} ${name}`],
	);
	pageIds[name] = row.id;
	let number = 1;
	for (const sourceId of versions) {
		await pool.query(
			`insert into page_versions (source_id, page_id, number, title, created)
			 values ($1, $2, $3, $4, now())`,
			[sourceId, row.id, number++, `${run} ${name}`],
		);
	}
}

async function marked(table: "pages" | "issues", ids: string[]) {
	const { rows } = await pool.query<{ id: string; marked: boolean }>(
		`select id, locally_changed_at is not null as marked from ${table} where id = any($1::uuid[])`,
		[ids],
	);
	return Object.fromEntries(rows.map((row) => [row.id, row.marked]));
}

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	project = await createProjectFixture(client, {
		run,
		key: fixtureKey(run),
		issues: [{ summary: "edited" }, { summary: "untouched" }],
	});
	const {
		rows: [space],
	} = await pool.query<{ id: string }>(
		`insert into spaces (source_id, key, name, type)
		 values ($1, $2, $3, 'global') returning id`,
		[`${run}:space`, `MB${run.slice(0, 6).toUpperCase()}`, `${run} space`],
	);
	spaceId = space.id;
	await page("edited", [`${run}:edited@1`, `fat:${randomUUID()}`]);
	await page("untouched", [`${run}:untouched@1`]);
	await pool.query(
		`insert into issue_history (source_id, issue_id, created)
		 values ($1, $2, now()), ($3, $4, now())`,
		[
			`local:${randomUUID()}`,
			project.issueIds[0],
			`${run}:jira-history`,
			project.issueIds[1],
		],
	);
	// What the migration sees on a database that ran before it: no marks yet.
	// The epoch value is the importer's way to clear a mark.
	await pool.query(
		"update pages set locally_changed_at = 'epoch' where space_id = $1",
		[spaceId],
	);
	await pool.query(
		"update issues set locally_changed_at = 'epoch' where project_id = $1",
		[project.projectId],
	);
});

afterAll(async () => {
	await pool.query("delete from spaces where id = $1", [spaceId]);
	await dropProjectFixture(client, run);
	await client.end();
	await pool.end();
});

test("pages with a local version and issues with local history get marked, once", async () => {
	const before = await marked("pages", Object.values(pageIds));
	expect(Object.values(before)).toEqual([false, false]);

	await pool.query(migration);

	expect(await marked("pages", [pageIds.edited])).toEqual({
		[pageIds.edited]: true,
	});
	expect(await marked("pages", [pageIds.untouched])).toEqual({
		[pageIds.untouched]: false,
	});
	expect(await marked("issues", [project.issueIds[0]])).toEqual({
		[project.issueIds[0]]: true,
	});
	expect(await marked("issues", [project.issueIds[1]])).toEqual({
		[project.issueIds[1]]: false,
	});

	const { rows: first } = await pool.query<{ at: string }>(
		"select locally_changed_at::text as at from issues where id = $1",
		[project.issueIds[0]],
	);
	await pool.query(migration);
	const { rows: second } = await pool.query<{ at: string }>(
		"select locally_changed_at::text as at from issues where id = $1",
		[project.issueIds[0]],
	);
	expect(second[0].at).toBe(first[0].at);
});
