import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

vi.mock("openid-client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("openid-client")>();
	return {
		...actual,
		discovery: vi.fn().mockRejectedValue(new Error("IdP unreachable")),
	};
});

import { sha256 } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { logout } from "../src/lib/server/oidc.ts";
import { sessions, users } from "../src/lib/server/schema.ts";

const run = randomUUID().slice(0, 8);
let userId: string;

beforeAll(async () => {
	await runMigrations();
	const [user] = await db
		.insert(users)
		.values({ username: `t-${run}-logout`, displayName: "Logout User" })
		.returning();
	userId = user.id;
});

afterAll(async () => {
	await db.delete(users).where(eq(users.id, userId));
	await pool.end();
});

test("logout still finishes locally when IdP discovery fails", async () => {
	const sessionId = `session-${run}`;
	await db.insert(sessions).values({
		idHash: sha256(sessionId),
		userId,
		idToken: "id-token",
		expiresAt: new Date(Date.now() + 60_000),
	});

	await expect(logout(sessionId)).resolves.toEqual({ redirect: "/" });
	const [row] = await db
		.select()
		.from(sessions)
		.where(eq(sessions.idHash, sha256(sessionId)));
	expect(row).toBeUndefined();
});
