import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { processGitlabDelivery } from "../src/lib/server/gitlab/events.ts";
import { gitlabDeliveries } from "../src/lib/server/schema-gitlab.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	type GitlabFixture,
	pushPayload,
	uniqueTag,
} from "./gitlab-fixtures.ts";

const gate = vi.hoisted(() => {
	let release!: () => void;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { blocked, release, calls: 0 };
});

vi.mock("../src/lib/server/gitlab/keys.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../src/lib/server/gitlab/keys.ts")>();
	return {
		...actual,
		loadProjectKeys: async () => {
			gate.calls += 1;
			if (gate.calls === 1) {
				await gate.blocked;
				throw new Error("the first worker failed late");
			}
			return [];
		},
	};
});

const tag = uniqueTag();
let fixture: GitlabFixture;

beforeAll(async () => {
	await runMigrations();
	fixture = await createGitlabFixture(tag);
});

afterAll(async () => {
	await cleanupGitlabFixture(fixture);
	await pool.end();
});

test("a reclaimed delivery is not overwritten by the worker that lost its lease", async () => {
	const [delivery] = await db
		.insert(gitlabDeliveries)
		.values({
			idempotencyKey: `${tag}:lease`,
			event: "Push Hook",
			payload: pushPayload(fixture, `${fixture.issueKey}-lease`, [
				{ sha: "d".repeat(40), title: "lease" },
			]),
		})
		.returning();

	const first = processGitlabDelivery(delivery.id);
	const deadline = Date.now() + 5_000;
	while (gate.calls === 0 && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(gate.calls).toBe(1);

	await db
		.update(gitlabDeliveries)
		.set({ startedAt: new Date(Date.now() - 10 * 60 * 1000) })
		.where(eq(gitlabDeliveries.id, delivery.id));
	await processGitlabDelivery(delivery.id);
	gate.release();

	await expect(first).rejects.toThrow("the first worker failed late");
	const [stored] = await db
		.select()
		.from(gitlabDeliveries)
		.where(eq(gitlabDeliveries.id, delivery.id));
	expect(stored?.status).toBe("processed");
});
