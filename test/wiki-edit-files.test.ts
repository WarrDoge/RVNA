import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { db, pool } from "../src/lib/server/db.ts";
import { removeOrphanFiles } from "../src/lib/server/wiki-edit/files.ts";
import { setupWiki } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
const root = process.env.ATTACHMENTS_DIR as string;

beforeAll(async () => {
	wiki = await setupWiki();
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

describe("orphan file cleanup", () => {
	test("removes the content directory once its last file is gone", async () => {
		const sha = `sha-${randomUUID()}`;
		const id = randomUUID();
		await mkdir(join(root, sha), { recursive: true });
		await writeFile(join(root, sha, id), "x");

		await removeOrphanFiles([`${sha}/${id}`]);

		await expect(readFile(join(root, sha, id))).rejects.toThrow();
		await expect(stat(join(root, sha))).rejects.toThrow();
	});

	test("checks a very large attachment list in chunks", async () => {
		const space = await wiki.space("B");
		const page = await wiki.page(wiki.admin, space.key, "Bulk attachments");
		await pool.query(
			`insert into page_attachments
			 (source_id, page_id, file_name, size, version, storage_path, sha256)
			 select 'bulk:' || g, $1, 'bulk-' || g, 0, g, 'bulk/' || g, 'bulk'
			 from generate_series(1, 65536) g`,
			[page.id],
		);
		await mkdir(join(root, "bulk"), { recursive: true });
		await writeFile(join(root, "bulk", "1"), "kept");
		await writeFile(join(root, "bulk", "0"), "orphan");

		const paths = [
			"bulk/0",
			...Array.from({ length: 65536 }, (_, index) => `bulk/${index + 1}`),
		];
		await expect(removeOrphanFiles(paths)).resolves.toBeUndefined();
		expect(await readFile(join(root, "bulk", "1"), "utf8")).toBe("kept");
		await expect(stat(join(root, "bulk", "0"))).rejects.toThrow();
	});

	test("a failed reference lookup never fails the caller", async () => {
		const target = db as unknown as { select: typeof db.select };
		const original = target.select;
		target.select = (() => {
			throw new Error("database is down");
		}) as typeof db.select;
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			await expect(
				removeOrphanFiles(["missing/file"]),
			).resolves.toBeUndefined();
			expect(log).toHaveBeenCalled();
		} finally {
			target.select = original;
			log.mockRestore();
		}
	});

	test("an unlink error is logged and does not fail the caller", async () => {
		const sha = `sha-${randomUUID()}`;
		const id = randomUUID();
		await mkdir(join(root, sha, id), { recursive: true });
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			await expect(
				removeOrphanFiles([`${sha}/${id}`]),
			).resolves.toBeUndefined();
			expect(log).toHaveBeenCalled();
		} finally {
			log.mockRestore();
		}
	});
});
