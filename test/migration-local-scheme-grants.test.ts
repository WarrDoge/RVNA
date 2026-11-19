import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { newRun } from "./admin-helpers.ts";

const run = newRun();
const migration = readFileSync(
	resolve("drizzle/0021_modify_reporter_local_schemes.sql"),
	"utf8",
);
const schemes: Record<string, string> = {};

async function scheme(name: string, sourceId: string) {
	const { rows } = await pool.query<{ id: string }>(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, '{}', '{}') returning id`,
		[sourceId, `${run} ${name}`],
	);
	schemes[name] = rows[0].id;
	return rows[0].id;
}

async function grant(schemeId: string, key: string, role: string) {
	await pool.query(
		`insert into permission_grants
		 (source_id, scheme_id, permission_key, holder_type, holder_parameter, raw)
		 values ($1, $2, $3, 'projectRole', $4, '{}')`,
		[`${run}:${schemeId}:${key}:${role}`, schemeId, key, role],
	);
}

async function keysOf(name: string) {
	const { rows } = await pool.query<{ key: string; holder: string }>(
		`select permission_key as key, holder_parameter as holder
		 from permission_grants where scheme_id = $1 order by 1, 2`,
		[schemes[name]],
	);
	return rows.map((row) => `${row.key}:${row.holder}`);
}

beforeAll(async () => {
	await runMigrations();
	const bare = await scheme("bare", `local:${run}-bare`);
	await grant(bare, "EDIT_ISSUES", "member");
	await grant(bare, "EDIT_ISSUES", "admin");
	const partial = await scheme("partial", `local:${run}-partial`);
	await grant(partial, "EDIT_ISSUES", "member");
	await grant(partial, "SCHEDULE_ISSUES", "admin");
	const imported = await scheme("imported", `${run}-imported`);
	await grant(imported, "EDIT_ISSUES", "member");
	const noEdit = await scheme("noEdit", `local:${run}-noedit`);
	await grant(noEdit, "BROWSE_PROJECTS", "member");
});

afterAll(async () => {
	await pool.query(
		"delete from permission_schemes where id = any($1::uuid[])",
		[Object.values(schemes)],
	);
	await pool.end();
});

test("local schemes get the holders of EDIT_ISSUES for the two keys they lack, once", async () => {
	await pool.query(migration);
	expect(await keysOf("bare")).toEqual([
		"EDIT_ISSUES:admin",
		"EDIT_ISSUES:member",
		"MODIFY_REPORTER:admin",
		"MODIFY_REPORTER:member",
		"SCHEDULE_ISSUES:admin",
		"SCHEDULE_ISSUES:member",
	]);
	// A scheme that already has SCHEDULE_ISSUES keeps exactly its own holders for it.
	expect(await keysOf("partial")).toEqual([
		"EDIT_ISSUES:member",
		"MODIFY_REPORTER:member",
		"SCHEDULE_ISSUES:admin",
	]);
	// Imported schemes keep their Jira grants; a scheme without EDIT_ISSUES gains nothing.
	expect(await keysOf("imported")).toEqual(["EDIT_ISSUES:member"]);
	expect(await keysOf("noEdit")).toEqual(["BROWSE_PROJECTS:member"]);

	const before = await keysOf("bare");
	await pool.query(migration);
	expect(await keysOf("bare")).toEqual(before);
});
