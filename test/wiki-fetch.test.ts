import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import {
	COMMENT_EXPAND,
	type ConfluenceClient,
} from "../src/importer/confluence.ts";
import {
	fetchAttachments,
	fetchWikiDataset,
	toComment,
} from "../src/importer/wiki-fetch.ts";
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
					{
						storagePath: "valid/file",
						sha256: createHash("sha256").update("hello").digest("hex"),
						size: 5,
					},
				],
			]),
		});

		expect(result[0]?.storagePath).toBe("valid/file");
	});
});

test("re-downloads a cached attachment whose bytes no longer match the digest", async () => {
	const directory = await temporaryDirectory();
	await mkdir(join(directory, "stale"), { recursive: true });
	await writeFile(join(directory, "stale", "file"), "world");
	const downloads: string[] = [];
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
				{
					storagePath: "stale/file",
					sha256: createHash("sha256").update("hello").digest("hex"),
					size: 5,
				},
			],
		]),
	});

	expect(downloads).toHaveLength(1);
	expect(result[0]?.sha256).toBe(
		createHash("sha256").update("hello").digest("hex"),
	);
});

function fakeClient(
	overrides: Partial<ConfluenceClient> = {},
): ConfluenceClient {
	return {
		listUsers: async () => [],
		listSpaces: async () => [],
		listSpacePermissions: async () => [],
		listContent: async () => [],
		listSpaceRootContent: async () => ({ page: [], blogpost: [] }),
		listChildPages: async () => [],
		listComments: async () => [],
		listVersions: async () => [],
		getHistoricalVersion: async () => {
			throw new Error("unexpected historical version request");
		},
		listAttachments: async () => [],
		listAttachmentVersions: async () => [],
		download: async () => Buffer.from(""),
		getJson: async () => ({}),
		...overrides,
	} as unknown as ConfluenceClient;
}

function space() {
	return {
		id: 1,
		key: "FIX",
		name: "Fixture Space",
		type: "global",
		status: "current",
	};
}

function content(sourceId: string, parentId: string | null = null) {
	return {
		id: sourceId,
		type: "page",
		status: "current",
		title: `Page ${sourceId}`,
		space: { key: "FIX" },
		ancestors: parentId ? [{ id: parentId }] : [],
		version: {
			number: 1,
			by: { userKey: "uk-author" },
			when: "2026-01-01T10:00:00Z",
		},
		history: {
			createdBy: { userKey: "uk-author" },
			createdDate: "2026-01-01T10:00:00Z",
		},
		body: {
			storage: { value: `<p>${sourceId}</p>` },
			view: { value: `<p>${sourceId}</p>` },
		},
	} satisfies ConfluenceContent;
}

function gate() {
	const waiting: (() => void)[] = [];
	return {
		wait: () =>
			new Promise<void>((resolve) => {
				waiting.push(resolve);
			}),
		releaseAll: () => {
			for (const resolve of waiting.splice(0)) resolve();
		},
	};
}

async function withReleases<T>(
	releases: ReturnType<typeof gate>,
	run: () => Promise<T>,
): Promise<T> {
	const timer = setInterval(releases.releaseAll, 0);
	try {
		return await run();
	} finally {
		clearInterval(timer);
	}
}

describe("wiki space permissions", () => {
	test("skips permission entries without a principal", async () => {
		const directory = await temporaryDirectory();
		const dataset = await fetchWikiDataset(
			fakeClient({
				listSpaces: async (status) => (status === "current" ? [space()] : []),
				listSpacePermissions: async () =>
					[
						{
							operation: { targetType: "space", operationKey: "read" },
							subject: { type: "user" },
						},
						{
							operation: { targetType: "space", operationKey: "read" },
							subject: { type: "group" },
						},
					] as never,
			}),
			{ attachmentsDir: directory, skipAttachments: true },
		);

		expect(dataset.spaces[0]?.permissions).toEqual([]);
		expect(Object.fromEntries(dataset.skippedPermissions)).toEqual({
			"space:read": 2,
		});
	});
});

describe("wiki users", () => {
	test("keeps a user that has a key but no username", async () => {
		const directory = await temporaryDirectory();
		const dataset = await fetchWikiDataset(
			fakeClient({
				listUsers: async () =>
					[
						{
							userKey: "uk-key-only",
							displayName: "Key Only",
						},
					] as never,
			}),
			{ attachmentsDir: directory, skipAttachments: true },
		);

		expect(dataset.users).toEqual([
			{
				userKey: "uk-key-only",
				username: "uk-key-only",
				displayName: "Key Only",
				email: null,
				avatarUrl: null,
				active: true,
			},
		]);
	});
});

describe("wiki fetch concurrency", () => {
	test("fetches historical versions without waiting for each other", async () => {
		const directory = await temporaryDirectory();
		const releases = gate();
		let inFlight = 0;
		let mostInFlight = 0;
		const page = content("100");
		page.version.number = 3;
		const client = fakeClient({
			listSpaces: async (status) => (status === "current" ? [space()] : []),
			listContent: async (_spaceKey, type, status) =>
				type === "page" && status === "current" ? [page] : [],
			listSpaceRootContent: async () => ({
				page: [content("100")],
				blogpost: [],
			}),
			listVersions: async () =>
				[{ number: 1 }, { number: 2 }, { number: 3 }] as never,
			getHistoricalVersion: async (_id, number) => {
				inFlight++;
				mostInFlight = Math.max(mostInFlight, inFlight);
				await releases.wait();
				inFlight--;
				return {
					id: "100",
					type: "page",
					status: "current",
					title: `Home v${number}`,
					body: {
						storage: { value: `<p>v${number}</p>` },
						view: { value: `<p>v${number}</p>` },
					},
				};
			},
		});

		const dataset = await withReleases(releases, () =>
			fetchWikiDataset(client, {
				attachmentsDir: directory,
				skipAttachments: true,
			}),
		);

		expect(mostInFlight).toBeGreaterThan(1);
		expect(
			dataset.spaces[0]?.pages[0]?.versions.map((version) => version.number),
		).toEqual([1, 2, 3]);
	});

	test("fetches pages without waiting for each other and keeps their order", async () => {
		const directory = await temporaryDirectory();
		const releases = gate();
		let inFlight = 0;
		let mostInFlight = 0;
		const client = fakeClient({
			listSpaces: async (status) => (status === "current" ? [space()] : []),
			listContent: async (_spaceKey, type, status) =>
				type === "page" && status === "current"
					? [content("100"), content("101")]
					: [],
			listSpaceRootContent: async () => ({
				page: [content("100"), content("101")],
				blogpost: [],
			}),
			listComments: async () => {
				inFlight++;
				mostInFlight = Math.max(mostInFlight, inFlight);
				await releases.wait();
				inFlight--;
				return [];
			},
		});

		const dataset = await withReleases(releases, () =>
			fetchWikiDataset(client, {
				attachmentsDir: directory,
				skipAttachments: true,
			}),
		);

		expect(mostInFlight).toBeGreaterThan(1);
		expect(dataset.spaces[0]?.pages.map((page) => page.sourceId)).toEqual([
			"100",
			"101",
		]);
	});

	test("bounds child page requests and names the failing parent", async () => {
		const directory = await temporaryDirectory();
		const releases = gate();
		let inFlight = 0;
		let mostInFlight = 0;
		const parents = ["p1", "p2", "p3", "p4", "p5", "p6"];
		const client = fakeClient({
			listSpaces: async (status) => (status === "current" ? [space()] : []),
			listContent: async (_spaceKey, type, status) =>
				type === "page" && status === "current"
					? parents.map((parent, index) => content(String(100 + index), parent))
					: [],
			listSpaceRootContent: async () => ({ page: [], blogpost: [] }),
			listChildPages: async () => {
				inFlight++;
				mostInFlight = Math.max(mostInFlight, inFlight);
				await releases.wait();
				inFlight--;
				return [];
			},
		});

		await withReleases(releases, () =>
			fetchWikiDataset(client, {
				attachmentsDir: directory,
				skipAttachments: true,
			}),
		);
		expect(mostInFlight).toBe(4);

		const failing = fakeClient({
			listSpaces: async (status) => (status === "current" ? [space()] : []),
			listContent: async (_spaceKey, type, status) =>
				type === "page" && status === "current" ? [content("100", "p3")] : [],
			listSpaceRootContent: async () => ({ page: [], blogpost: [] }),
			listChildPages: async () => {
				throw new Error("boom");
			},
		});
		await expect(
			fetchWikiDataset(failing, {
				attachmentsDir: directory,
				skipAttachments: true,
			}),
		).rejects.toThrow(/p3/);
	});

	test("stops taking pages after the first failure", async () => {
		const directory = await temporaryDirectory();
		const pages = Array.from({ length: 8 }, (_, index) =>
			content(String(200 + index)),
		);
		let comments = 0;
		const client = fakeClient({
			listSpaces: async (status) => (status === "current" ? [space()] : []),
			listContent: async (_spaceKey, type, status) =>
				type === "page" && status === "current" ? pages : [],
			listSpaceRootContent: async () => ({ page: [], blogpost: [] }),
			listComments: async (id) => {
				comments += 1;
				if (id === "200") throw new Error("boom");
				return [];
			},
		});

		await expect(
			fetchWikiDataset(client, {
				attachmentsDir: directory,
				skipAttachments: true,
			}),
		).rejects.toThrow(/200/);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(comments).toBeLessThanOrEqual(4);
	});
});

describe("wiki attachment version errors", () => {
	test("reports the failure and falls back to the current version", async () => {
		const directory = await temporaryDirectory();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const client = {
				listAttachments: async () => [
					{
						id: "attachment-1",
						title: "notes.txt",
						version: { number: 2 },
						_links: { download: "/download/attachments/1/notes.txt" },
					},
				],
				listAttachmentVersions: async () => {
					throw new Error("401 unauthorized");
				},
				download: async () => Buffer.from("hello"),
			} as unknown as ConfluenceClient;

			const result = await fetchAttachments(client, "page-1", {
				attachmentsDir: directory,
				skipAttachments: false,
			});

			expect(result.map((attachment) => attachment.version)).toEqual([2]);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("attachment-1"),
			);
		} finally {
			warn.mockRestore();
		}
	});
});
