import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	createMessengerLinkCode,
	redeemMessengerLinkCode,
} from "../src/lib/server/messenger/links.ts";
import {
	messengerConfig,
	messengerLinkCodes,
	users,
} from "../src/lib/server/schema.ts";

const codeQueue = vi.hoisted(() => ({ next: [] as Buffer[] }));

vi.mock("node:crypto", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:crypto")>();
	return {
		...actual,
		randomBytes: (size: number) => {
			const next = codeQueue.next.shift();
			if (size === 8 && next) return next;
			return actual.randomBytes(size);
		},
	};
});

const run = randomUUID().slice(0, 8);
let actor: CurrentUser;
let actorId: string;
let otherId: string;

async function insertCode(userId: string, code: string) {
	const [row] = await db
		.insert(messengerLinkCodes)
		.values({
			userId,
			code,
			expiresAt: new Date(Date.now() + 60_000),
		})
		.returning();
	return row;
}

beforeEach(async () => {
	await db.delete(messengerLinkCodes);
	codeQueue.next = [];
});

beforeAll(async () => {
	await runMigrations();
	await db.delete(messengerLinkCodes);
	await db.delete(messengerConfig);
	await db.insert(messengerConfig).values({
		id: 1,
		homeserverUrl: "https://matrix.example.test",
		enabled: true,
		botMatrixId: "@bot:matrix.example.test",
	});
	const [actorRow] = await db
		.insert(users)
		.values({ username: `t-${run}-linker`, displayName: "Linker" })
		.returning();
	actorId = actorRow.id;
	actor = { id: actorId } as CurrentUser;
	const [otherRow] = await db
		.insert(users)
		.values({ username: `t-${run}-other`, displayName: "Other" })
		.returning();
	otherId = otherRow.id;
});

afterAll(async () => {
	await db.delete(messengerLinkCodes);
	await db.delete(messengerConfig);
	await db.delete(users).where(eq(users.id, actorId));
	await db.delete(users).where(eq(users.id, otherId));
	await pool.end();
});

test("a code collision is retried instead of failing the request", async () => {
	await insertCode(otherId, "AAAAAAAA");
	const previous = await insertCode(actorId, "CCCCCCCC");
	codeQueue.next = [Buffer.alloc(8, 0), Buffer.alloc(8, 1)];

	const result = await createMessengerLinkCode(actor);

	expect(result.code).toBe("BBBBBBBB");
	const [old] = await db
		.select()
		.from(messengerLinkCodes)
		.where(eq(messengerLinkCodes.id, previous.id));
	expect(old.usedAt).not.toBeNull();
	const [other] = await db
		.select()
		.from(messengerLinkCodes)
		.where(eq(messengerLinkCodes.code, "AAAAAAAA"));
	expect(other.usedAt).toBeNull();
});

test("a code that cannot be inserted leaves the previous code usable", async () => {
	await insertCode(otherId, "AAAAAAAA");
	const previous = await insertCode(actorId, "DDDDDDDD");
	codeQueue.next = Array.from({ length: 5 }, () => Buffer.alloc(8, 0));

	await expect(createMessengerLinkCode(actor)).rejects.toThrow();

	const [old] = await db
		.select()
		.from(messengerLinkCodes)
		.where(eq(messengerLinkCodes.id, previous.id));
	expect(old.usedAt).toBeNull();
});

test("a successful link retires the user's other unused codes", async () => {
	await insertCode(actorId, "EEEEEEEE");
	await insertCode(actorId, "FFFFFFFF");

	const linked = await redeemMessengerLinkCode("@matrix-one:test", "EEEEEEEE");
	expect(linked.ok).toBe(true);
	const rows = await db
		.select()
		.from(messengerLinkCodes)
		.where(eq(messengerLinkCodes.userId, actorId));
	expect(rows.every((row) => row.usedAt !== null)).toBe(true);

	const takeover = await redeemMessengerLinkCode(
		"@matrix-two:test",
		"FFFFFFFF",
	);
	expect(takeover.ok).toBe(false);
	if (!takeover.ok) expect(takeover.message).toContain("already been used");
	const [user] = await db
		.select({ messengerMatrixId: users.messengerMatrixId })
		.from(users)
		.where(eq(users.id, actorId));
	expect(user.messengerMatrixId).toBe("@matrix-one:test");
});
