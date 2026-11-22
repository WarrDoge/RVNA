import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	clearMessengerToken,
	messengerSettings,
	saveMessengerToken,
} from "../src/lib/server/messenger/config.ts";
import { messengerConfig } from "../src/lib/server/schema.ts";

beforeAll(async () => {
	await runMigrations();
	await db.delete(messengerConfig);
});

afterAll(async () => {
	await db.delete(messengerConfig);
	await pool.end();
});

test("changing the bot token forgets the previous bot identity and sync token", async () => {
	await db.insert(messengerConfig).values({
		id: 1,
		homeserverUrl: "https://matrix.example.test",
		botMatrixId: "@old-bot:matrix.example.test",
		serverName: "matrix.example.test",
		sinceToken: "old-sync-token",
	});

	await saveMessengerToken("syt_new_token");
	let settings = await messengerSettings();
	expect(settings.accessToken).toBe("syt_new_token");
	expect(settings.botMatrixId).toBeNull();
	expect(settings.serverName).toBeNull();
	expect(settings.sinceToken).toBeNull();

	await db
		.update(messengerConfig)
		.set({
			botMatrixId: "@old-bot:matrix.example.test",
			serverName: "matrix.example.test",
			sinceToken: "old-sync-token",
		})
		.where(eq(messengerConfig.id, 1));
	await clearMessengerToken();
	settings = await messengerSettings();
	expect(settings.accessToken).toBeNull();
	expect(settings.botMatrixId).toBeNull();
	expect(settings.serverName).toBeNull();
	expect(settings.sinceToken).toBeNull();
});
