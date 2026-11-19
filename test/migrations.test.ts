import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const scratch = `rvna_migration_race_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const scratchUrl = new URL(databaseUrl);
scratchUrl.pathname = `/${scratch}`;

const admin = new pg.Client({ connectionString: adminUrl.toString() });
let created = false;

function migrateInChild(calls = 1) {
	return new Promise<{ code: number | null; output: string }>(
		(resolveChild) => {
			const child = spawn(
				process.execPath,
				[
					"--input-type=module",
					"-e",
					`const db = await import("./src/lib/server/db.ts"); await Promise.all(Array.from({ length: ${calls} }, () => db.runMigrations())); await db.pool.end();`,
				],
				{
					cwd: process.cwd(),
					env: { ...process.env, DATABASE_URL: scratchUrl.toString() },
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			let output = "";
			child.stdout.on("data", (chunk) => {
				output += String(chunk);
			});
			child.stderr.on("data", (chunk) => {
				output += String(chunk);
			});
			child.on("error", (error) => {
				output += String(error);
			});
			child.on("close", (code) => resolveChild({ code, output }));
		},
	);
}

beforeAll(async () => {
	await admin.connect();
	await admin.query(`create database "${scratch}"`);
	created = true;
});

afterAll(async () => {
	if (created) {
		await admin.query(`drop database if exists "${scratch}" with (force)`);
	}
	await admin.end();
});

test("two processes migrate an empty database without a race", {
	timeout: 60_000,
}, async () => {
	const [first, second] = await Promise.all([
		migrateInChild(),
		migrateInChild(),
	]);
	expect(first.code, first.output).toBe(0);
	expect(second.code, second.output).toBe(0);

	const client = new pg.Client({ connectionString: scratchUrl.toString() });
	await client.connect();
	try {
		const journal = JSON.parse(
			readFileSync(resolve("drizzle/meta/_journal.json"), "utf8"),
		) as { entries: unknown[] };
		const migrations = await client.query<{ count: number }>(
			"select count(*)::int as count from drizzle.__drizzle_migrations",
		);
		expect(migrations.rows[0].count).toBe(journal.entries.length);

		const schema = await client.query<{ tables: number }>(
			`select count(*)::int as tables from pg_tables
			 where schemaname = 'public'`,
		);
		expect(schema.rows[0].tables).toBeGreaterThan(100);
		for (const table of ["users", "issues", "email_batches", "sessions"]) {
			const found = await client.query(
				"select to_regclass($1) is not null as present",
				[`public.${table}`],
			);
			expect(found.rows[0].present, table).toBe(true);
		}
	} finally {
		await client.end();
	}
});

test("more concurrent calls than pool connections still finish", {
	timeout: 60_000,
}, async () => {
	const result = await migrateInChild(12);
	expect(result.code, result.output).toBe(0);
});
