import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { HttpError } from "../src/lib/server/http.ts";
import { saveMessengerAccessToken } from "../src/lib/server/messenger/routes.ts";
import { messengerConfig } from "../src/lib/server/schema.ts";

vi.mock("../src/lib/server/messenger/crypto.ts", () => ({
	encryptionAvailable: () => false,
	encryptSecret: () => {
		throw new Error("no key");
	},
	decryptSecret: () => {
		throw new Error("no key");
	},
}));

beforeAll(async () => {
	await runMigrations();
	await db.delete(messengerConfig);
});

afterAll(async () => {
	await db.delete(messengerConfig);
	await pool.end();
});

test("without SECRETS_KEY the token is refused and nothing is stored", async () => {
	const admin = {
		id: "00000000-0000-4000-8000-000000000001",
		username: "secrets-admin",
		displayName: "Secrets Admin",
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: true,
		mustChangePassword: false,
		hasPassword: false,
	};
	const error = await saveMessengerAccessToken(admin, {
		token: "syt_plain_text_token",
	}).catch((cause: unknown) => cause);
	expect(error).toBeInstanceOf(HttpError);
	expect((error as HttpError).status).toBe(400);
	expect((error as HttpError).message).toContain("SECRETS_KEY");

	const rows = await db
		.select()
		.from(messengerConfig)
		.where(eq(messengerConfig.id, 1));
	expect(rows.every((row) => row.accessToken === null)).toBe(true);
});
