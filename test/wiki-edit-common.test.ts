import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { spaces } from "../src/lib/server/schema-wiki.ts";
import {
	loadSpace,
	pgCode,
	pgConstraint,
} from "../src/lib/server/wiki-edit/common.ts";

const run = randomUUID().slice(0, 8);
const mixedKey = `MySpace${run}`;

afterAll(async () => {
	await pool.query("delete from spaces where key = $1", [mixedKey]);
	await pool.end();
});

test("a cyclic cause chain does not hang the code lookup", () => {
	const error = new Error("boom") as Error & { cause?: unknown };
	error.cause = error;
	expect(pgCode(error)).toBeUndefined();
	expect(pgConstraint(error)).toBeUndefined();
});

test("the cause walk keeps a bounded depth", () => {
	const error = new Error("boom") as Error & { cause?: unknown };
	let current = error;
	for (let depth = 0; depth < 20; depth += 1) {
		const next = new Error(`cause ${depth}`) as Error & { cause?: unknown };
		current.cause = next;
		current = next;
	}
	current.cause = { code: "23505", constraint: "spaces_key_unique" };
	expect(pgCode(error)).toBeUndefined();
	expect(pgConstraint(error)).toBeUndefined();

	const shallow = new Error("boom") as Error & { cause?: unknown };
	shallow.cause = { cause: { code: "23505" } };
	expect(pgCode(shallow)).toBe("23505");
});

test("a mixed-case stored space key resolves from any casing", async () => {
	await runMigrations();
	await db.insert(spaces).values({
		sourceId: `mixed-space-${run}`,
		key: mixedKey,
		name: `Mixed space ${run}`,
	});
	const space = await loadSpace(db, mixedKey.toLowerCase());
	expect(space.key).toBe(mixedKey);
	expect((await loadSpace(db, mixedKey.toUpperCase())).key).toBe(mixedKey);
});
