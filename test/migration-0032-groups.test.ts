import { randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationsFolder = resolve("drizzle");
const scratch = `rvna_migration_0032_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const scratchUrl = new URL(databaseUrl);
scratchUrl.pathname = `/${scratch}`;

const admin = new pg.Client({ connectionString: adminUrl.toString() });
let client: pg.Client;
let upTo0031: string;
let created = false;

beforeAll(async () => {
	await admin.connect();
	await admin.query(`create database "${scratch}"`);
	created = true;

	upTo0031 = await mkdtemp(join(tmpdir(), "rvna-migration-0031-"));
	const journal = JSON.parse(
		await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
	) as { entries: { idx: number; tag: string }[] };
	const entries = journal.entries.filter((entry) => entry.idx <= 31);
	await mkdir(join(upTo0031, "meta"));
	for (const entry of entries) {
		await copyFile(
			join(migrationsFolder, `${entry.tag}.sql`),
			join(upTo0031, `${entry.tag}.sql`),
		);
	}
	await writeFile(
		join(upTo0031, "meta/_journal.json"),
		JSON.stringify({ ...journal, entries }),
	);

	client = new pg.Client({ connectionString: scratchUrl.toString() });
	await client.connect();
	await migrate(drizzle(client), { migrationsFolder: upTo0031 });
});

afterAll(async () => {
	await client?.end();
	if (upTo0031) await rm(upTo0031, { recursive: true, force: true });
	if (created) {
		await admin.query(`drop database if exists "${scratch}" with (force)`);
	}
	await admin.end();
});

test("the repair merges groups that differ only by case and keeps both members", {
	timeout: 60_000,
}, async () => {
	const groupName = "Migration Case Group";
	const first = await client.query<{ id: string }>(
		"insert into users (username, display_name) values ($1, $2) returning id",
		["migration-case-first", "Migration Case First"],
	);
	const second = await client.query<{ id: string }>(
		"insert into users (username, display_name) values ($1, $2) returning id",
		["migration-case-second", "Migration Case Second"],
	);
	const upper = await client.query<{ id: string }>(
		"insert into groups (name, local) values ($1, false) returning id",
		[groupName],
	);
	const lower = await client.query<{ id: string }>(
		"insert into groups (name, local) values ($1, false) returning id",
		[groupName.toLowerCase()],
	);
	await client.query(
		"insert into user_groups (user_id, group_id, source) values ($1, $2, 'oidc'), ($3, $4, 'oidc')",
		[first.rows[0].id, upper.rows[0].id, second.rows[0].id, lower.rows[0].id],
	);

	await migrate(drizzle(client), { migrationsFolder });

	const groups = await client.query<{ id: string }>(
		"select id from groups where lower(name) = lower($1)",
		[groupName],
	);
	expect(groups.rows).toHaveLength(1);
	const members = await client.query<{ user_id: string }>(
		"select user_id from user_groups where group_id = $1 order by user_id",
		[groups.rows[0].id],
	);
	expect(members.rows.map((row) => row.user_id).sort()).toEqual(
		[first.rows[0].id, second.rows[0].id].sort(),
	);
});
