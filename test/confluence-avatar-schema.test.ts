import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const schema = `rvna_avatar_schema_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
let admin: pg.Client;
let avatars: typeof import("../src/importer/avatars.ts");
let importerDb: typeof import("../src/importer/db.ts");

beforeAll(async () => {
	admin = new pg.Client({ connectionString: databaseUrl });
	await admin.connect();
	await migrate(drizzle(admin), { migrationsFolder: resolve("drizzle") });
	await admin.query(`create schema "${schema}"`);

	const scoped = new URL(databaseUrl);
	scoped.searchParams.set("options", `-c search_path=${schema}`);
	process.env.DATABASE_URL = scoped.toString();
	importerDb = await import("../src/importer/db.ts");
	avatars = await import("../src/importer/avatars.ts");
});

afterAll(async () => {
	await importerDb?.pool.end();
	await admin?.query(`drop schema if exists "${schema}" cascade`);
	await admin?.end();
	process.env.DATABASE_URL = databaseUrl;
});

test("confluence avatars are skipped when the tables are outside the search path", async () => {
	let userLists = 0;
	const client = {
		async listUsers() {
			userLists++;
			return [];
		},
		async getBytes() {
			throw new Error("no download expected");
		},
	};

	const counts = await avatars.importConfluenceAvatars(client as never, {
		baseUrl: "https://confluence.example.test",
		avatarsDir: "/tmp/unused-avatars",
		scope: { spaceIds: [], userIds: [] },
	});

	expect(counts.spaces).toEqual({
		stored: 0,
		updated: 0,
		unchanged: 0,
		skipped: 0,
		failed: 0,
	});
	expect(counts.confluenceUsers).toEqual({
		stored: 0,
		updated: 0,
		unchanged: 0,
		skipped: 0,
		failed: 0,
	});
	expect(userLists).toBe(0);
});
