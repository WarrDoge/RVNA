import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { describe, expect, test } from "vitest";
import {
	fileChecks,
	loadAttachmentFiles,
} from "../src/importer/parity/files.ts";
import type { TableSet } from "../src/importer/parity/types.ts";

function poolWith(handler: (sql: string) => { rows: unknown[] }): pg.Pool {
	return { query: async (sql: string) => handler(sql) } as unknown as pg.Pool;
}

function tablesWith(...tables: string[]): TableSet {
	return {
		has: (table) => tables.includes(table),
		columns: () => new Set(),
		hasColumns: () => false,
	};
}

describe("parity attachment files", () => {
	test("a missing attachments table yields no Jira rows", async () => {
		const pool = poolWith((sql) => {
			if (/\bfrom attachments\b/.test(sql)) {
				throw new Error('relation "attachments" does not exist');
			}
			return { rows: [] };
		});
		await expect(
			loadAttachmentFiles(pool, tablesWith("page_attachments")),
		).resolves.toEqual({ jira: [], wiki: [] });
	});

	test("maps Jira and wiki attachment rows", async () => {
		const pool = poolWith((sql) => {
			if (sql.includes("from attachments")) {
				return {
					rows: [
						{
							source_id: "jira-attachment",
							storage_path: "jira/file.bin",
							size: 3,
							sha256: "jira-hash",
						},
					],
				};
			}
			if (sql.includes("from page_attachments")) {
				return {
					rows: [
						{
							source_id: "wiki-attachment",
							storage_path: "wiki/file.bin",
							size: 4,
							sha256: "wiki-hash",
						},
					],
				};
			}
			throw new Error(`unexpected query: ${sql}`);
		});
		await expect(
			loadAttachmentFiles(pool, tablesWith("attachments", "page_attachments")),
		).resolves.toEqual({
			jira: [
				{
					sourceId: "jira-attachment",
					storagePath: "jira/file.bin",
					size: 3,
					sha256: "jira-hash",
				},
			],
			wiki: [
				{
					sourceId: "wiki-attachment",
					storagePath: "wiki/file.bin",
					size: 4,
					sha256: "wiki-hash",
				},
			],
		});
	});

	test("the hash check counts only files that were hashed", async () => {
		const root = await mkdtemp(join(tmpdir(), "rvna-parity-"));
		try {
			await writeFile(join(root, "wrong.bin"), "hello");
			const rows = {
				jira: [
					{
						sourceId: "wrong",
						storagePath: "wrong.bin",
						size: 999,
						sha256: "0".repeat(64),
					},
				],
				wiki: [],
			};
			const checks = await fileChecks(rows, root, false, "jira");
			const attachments = checks.find(
				(check) => check.name === "files.jira.attachments",
			);
			const hashes = checks.find((check) => check.name === "files.jira.sha256");
			expect(attachments?.status).toBe("MISMATCH");
			expect(attachments?.details).toEqual(["wrong"]);
			expect(hashes?.status).toBe("OK");
			expect(hashes?.live).toBe(0);
			expect(hashes?.database).toBe(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a matching file passes both checks", async () => {
		const root = await mkdtemp(join(tmpdir(), "rvna-parity-"));
		try {
			await writeFile(join(root, "good.bin"), "hello");
			const rows = {
				jira: [
					{
						sourceId: "good",
						storagePath: "good.bin",
						size: 5,
						sha256: createHash("sha256").update("hello").digest("hex"),
					},
				],
				wiki: [],
			};
			const checks = await fileChecks(rows, root, false, "jira");
			const attachments = checks.find(
				(check) => check.name === "files.jira.attachments",
			);
			const hashes = checks.find((check) => check.name === "files.jira.sha256");
			expect(attachments?.status).toBe("OK");
			expect(attachments?.live).toBe(1);
			expect(hashes?.status).toBe("OK");
			expect(hashes?.live).toBe(1);
			expect(hashes?.database).toBe(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
