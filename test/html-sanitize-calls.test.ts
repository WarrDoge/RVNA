import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { users } from "../src/lib/server/schema.ts";

const sanitize = vi.hoisted(() => vi.fn());

vi.mock("sanitize-html", async () => {
	const actual = await vi.importActual<{
		default: typeof import("sanitize-html");
	}>("sanitize-html");
	sanitize.mockImplementation(actual.default);
	return { default: sanitize };
});

const { extractMentionedUserIds, sanitizeBodyHtml } = await import(
	"../src/lib/server/html.ts"
);

const userId = randomUUID();
const html = `<p><a class="user-hover" data-user-id="${userId}">@Sanitize</a></p>`;

beforeAll(async () => {
	await runMigrations();
	await db.insert(users).values({
		id: userId,
		username: `t-sanitize-${userId.slice(0, 8)}`,
		displayName: "Sanitize Count",
	});
});

afterAll(async () => {
	await db.delete(users).where(eq(users.id, userId));
	await pool.end();
});

test("a mention body is parsed at most twice", async () => {
	sanitize.mockClear();
	const clean = await sanitizeBodyHtml(html);
	expect(clean).toContain("@Sanitize Count");
	expect(sanitize).toHaveBeenCalledTimes(2);
});

test("mention ids are collected in one pass", () => {
	sanitize.mockClear();
	expect(extractMentionedUserIds(html)).toEqual([userId]);
	expect(sanitize).toHaveBeenCalledTimes(1);
});
