import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { processGitlabDelivery } from "../src/lib/server/gitlab/events.ts";
import { gitlabDeliveries } from "../src/lib/server/schema-gitlab.ts";

vi.mock("../src/lib/server/gitlab/config.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../src/lib/server/gitlab/config.ts")>();
	return {
		...actual,
		recordDelivery: async () => {
			throw new Error("the audit write failed");
		},
	};
});

const tag = `audit-${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
	await runMigrations();
});

afterAll(async () => {
	await db
		.delete(gitlabDeliveries)
		.where(eq(gitlabDeliveries.idempotencyKey, `${tag}:ignored`));
	await pool.end();
});

test("a failed audit write leaves a processed delivery processed", async () => {
	const [delivery] = await db
		.insert(gitlabDeliveries)
		.values({
			idempotencyKey: `${tag}:ignored`,
			event: "Tag Push Hook",
			payload: { object_kind: "tag_push", ref: "refs/tags/v1" },
		})
		.returning();
	await processGitlabDelivery(delivery.id);
	const [stored] = await db
		.select()
		.from(gitlabDeliveries)
		.where(eq(gitlabDeliveries.id, delivery.id));
	expect(stored?.status).toBe("ignored");
});
