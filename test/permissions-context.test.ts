import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import {
	addProjectAdmin,
	issuePermissionContext,
} from "../src/lib/server/permissions.ts";

afterAll(async () => {
	await pool.end();
});

test("a 36-character non-UUID is looked up as a key, not a broken id", async () => {
	await runMigrations();
	await expect(
		issuePermissionContext("------------------------------------"),
	).resolves.toBeNull();
});

test("adding a project admin refuses an unknown user", async () => {
	await runMigrations();
	await expect(addProjectAdmin(randomUUID(), randomUUID())).rejects.toThrow(
		"User not found",
	);
});
