import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { messengerSettings } from "../src/lib/server/messenger/config.ts";
import { messengerConfig } from "../src/lib/server/schema.ts";

beforeAll(async () => {
	await runMigrations();
	await db.delete(messengerConfig);
});

afterAll(async () => {
	await db.delete(messengerConfig);
	await pool.end();
});

test("a settings row that cannot be read or created is a clear error", async () => {
	await db.delete(messengerConfig);
	await db.execute(
		sql`drop trigger if exists test_skip_messenger_config on messenger_config`,
	);
	await db.execute(
		sql`create or replace function test_skip_messenger_config() returns trigger language plpgsql as $$ begin return null; end $$`,
	);
	await db.execute(
		sql`create trigger test_skip_messenger_config before insert on messenger_config for each row execute function test_skip_messenger_config()`,
	);
	try {
		await expect(messengerSettings()).rejects.toThrow(/Messenger settings row/);
	} finally {
		await db.execute(
			sql`drop trigger if exists test_skip_messenger_config on messenger_config`,
		);
		await db.execute(sql`drop function if exists test_skip_messenger_config()`);
	}
});

test("an unreadable stored token is reported instead of looking unset", async () => {
	await db.delete(messengerConfig);
	await db.insert(messengerConfig).values({
		id: 1,
		homeserverUrl: "https://matrix.example.test",
		accessToken: "v1:not-a-real-ciphertext",
	});
	const settings = await messengerSettings();
	expect(settings.accessToken).toBeNull();
	expect(settings.lastError).toMatch(/access token could not be decrypted/i);
});
