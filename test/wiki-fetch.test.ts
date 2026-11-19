import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
	COMMENT_EXPAND,
	type ConfluenceClient,
} from "../src/importer/confluence.ts";
import { fetchAttachments, toComment } from "../src/importer/wiki-fetch.ts";
import type { ConfluenceContent } from "../src/importer/wiki-types.ts";

const directories: string[] = [];

async function temporaryDirectory() {
	const directory = await mkdtemp(join(tmpdir(), "rvna-wiki-fetch-"));
	directories.push(directory);
	return directory;
}

afterAll(async () => {
	for (const directory of directories) {
		await rm(directory, { recursive: true, force: true });
	}
});

function commentContent(): ConfluenceContent {
	return {
		id: "comment-1",
		type: "comment",
		status: "current",
		body: {
			storage: { value: "<p>comment</p>" },
			view: { value: "<p>comment</p>" },
		},
		version: {
			number: 2,
			by: { userKey: "editor" },
			when: "2026-02-02T10:00:00Z",
		},
		history: {
			createdBy: { userKey: "author" },
			createdDate: "2026-01-01T10:00:00Z",
		},
	};
}

describe("wiki comment mapping", () => {
	test("uses the original author and creation date, not the last edit", () => {
		const comment = toComment(commentContent());
		expect(comment.authorUserKey).toBe("author");
		expect(comment.created?.toISOString()).toBe("2026-01-01T10:00:00.000Z");
		expect(comment.updated?.toISOString()).toBe("2026-02-02T10:00:00.000Z");
		expect(COMMENT_EXPAND).toContain("history");
	});
});

describe("wiki attachment reuse", () => {
	test("re-downloads a cached attachment whose file is missing", async () => {
		const directory = await temporaryDirectory();
		const downloads: string[] = [];
		const client = {
			listAttachments: async () => [
				{
					id: "attachment-1",
					title: "notes.txt",
					metadata: { mediaType: "text/plain" },
					version: { number: 1 },
					_links: { download: "/download/attachments/1/notes.txt" },
				},
			],
			listAttachmentVersions: async () => [
				{
					number: 1,
					by: { userKey: "author" },
					when: "2026-01-01T10:00:00Z",
				},
			],
			download: async (path: string) => {
				downloads.push(path);
				return Buffer.from("hello");
			},
		} as unknown as ConfluenceClient;

		const result = await fetchAttachments(client, "page-1", {
			attachmentsDir: directory,
			skipAttachments: false,
			existingAttachments: new Map([
				[
					"attachment-1:1",
					{ storagePath: "missing/file", sha256: "old", size: 5 },
				],
			]),
		});

		expect(downloads).toHaveLength(1);
		expect(result[0]?.sha256).toBe(
			createHash("sha256").update("hello").digest("hex"),
		);
		const info = await stat(join(directory, result[0]?.storagePath ?? ""));
		expect(info.size).toBe(5);
	});

	test("reuses a cached attachment whose file still matches", async () => {
		const directory = await temporaryDirectory();
		await mkdir(join(directory, "valid"), { recursive: true });
		await writeFile(join(directory, "valid", "file"), "hello");
		const client = {
			listAttachments: async () => [
				{
					id: "attachment-1",
					title: "notes.txt",
					version: { number: 1 },
					_links: { download: "/download/attachments/1/notes.txt" },
				},
			],
			listAttachmentVersions: async () => [{ number: 1 }],
			download: async () => {
				throw new Error("the cached file should be reused");
			},
		} as unknown as ConfluenceClient;

		const result = await fetchAttachments(client, "page-1", {
			attachmentsDir: directory,
			skipAttachments: false,
			existingAttachments: new Map([
				[
					"attachment-1:1",
					{ storagePath: "valid/file", sha256: "old", size: 5 },
				],
			]),
		});

		expect(result[0]?.storagePath).toBe("valid/file");
	});
});
