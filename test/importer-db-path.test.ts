import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/importer/db.ts";

const originalDirectory = process.cwd();

afterAll(async () => {
	process.chdir(originalDirectory);
	await pool.end();
});

test("migrations run from a working directory other than the repository root", async () => {
	const directory = await mkdtemp(join(tmpdir(), "rvna-importer-"));
	try {
		process.chdir(directory);
		await expect(runMigrations()).resolves.toBeUndefined();
	} finally {
		process.chdir(originalDirectory);
		await rm(directory, { recursive: true, force: true });
	}
});
