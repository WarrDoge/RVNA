import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	type ExistingAttachment,
	fetchDataset,
} from "../src/importer/fetch.ts";
import type { JiraClient } from "../src/importer/jira.ts";
import type { JiraAttachment } from "../src/importer/types.ts";

const directories: string[] = [];

async function attachmentDirectory() {
	const directory = await mkdtemp(join(tmpdir(), "rvna-attachment-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

function sha256(bytes: Buffer) {
	return createHash("sha256").update(bytes).digest("hex");
}

function createClient(bytes: Buffer, attachment: JiraAttachment) {
	const issue = {
		id: "1",
		key: "DEMO-1",
		fields: {
			summary: "Attachment",
			comment: { total: 0 },
			worklog: { total: 0 },
			watches: { watchCount: 0 },
			attachment: [attachment],
		},
		changelog: { total: 0, histories: [] },
	};
	return {
		async getJson(path: string) {
			if (path === "/rest/api/2/user/search") return [];
			if (
				path === "/rest/api/2/issuetype" ||
				path === "/rest/api/2/priority" ||
				path === "/rest/api/2/resolution" ||
				path === "/rest/api/2/status" ||
				path === "/rest/api/2/field"
			) {
				return [];
			}
			if (path === "/rest/api/2/issueLinkType") {
				return { issueLinkTypes: [] };
			}
			if (path === "/rest/api/2/project") {
				return [
					{
						id: "1",
						key: "DEMO",
						name: "Demo",
						projectTypeKey: "software",
					},
				];
			}
			if (path === "/rest/api/2/project/DEMO") {
				return {
					id: "1",
					key: "DEMO",
					name: "Demo",
					projectTypeKey: "software",
					issueTypes: [],
				};
			}
			if (
				path.endsWith("/components") ||
				path.endsWith("/versions") ||
				path.endsWith("/statuses")
			) {
				return [];
			}
			if (path === "/rest/api/2/search") {
				return { issues: [issue], total: 1 };
			}
			throw new Error(`unexpected request ${path}`);
		},
		async getBytes(path: string) {
			if (path !== attachment.content) {
				throw new Error(`unexpected download ${path}`);
			}
			return bytes;
		},
	} as unknown as JiraClient;
}

function attachment(size: number): JiraAttachment {
	return {
		id: "10",
		filename: "fixture.txt",
		size,
		content: "https://jira.example.test/secure/attachment/10/fixture.txt",
	};
}

async function fetchAttachments(
	client: JiraClient,
	attachmentsDir: string,
	existingAttachments?: Map<string, ExistingAttachment>,
) {
	const dataset = await fetchDataset(client, {
		attachmentsDir,
		skipAttachments: false,
		privateApis: false,
		existingAttachments,
	});
	return dataset.issues[0]?.attachments[0];
}

describe("attachment cache", () => {
	test("re-downloads a cached file whose contents do not match its hash", async () => {
		const directory = await attachmentDirectory();
		const correct = Buffer.from("correct-bytes");
		const wrong = Buffer.from("wrong-bytes!!");
		expect(wrong).toHaveLength(correct.length);
		const existingSha = sha256(correct);
		const storagePath = join(existingSha, "10");
		const target = join(directory, storagePath);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, wrong);

		const imported = await fetchAttachments(
			createClient(correct, attachment(correct.length)),
			directory,
			new Map([
				[
					"10",
					{
						storagePath,
						sha256: existingSha,
						size: wrong.length,
					},
				],
			]),
		);

		expect(imported?.sha256).toBe(sha256(correct));
		expect(
			await readFile(join(directory, imported?.storagePath ?? "")),
		).toEqual(correct);
	});

	test("replaces a truncated file left by an earlier write", async () => {
		const directory = await attachmentDirectory();
		const correct = Buffer.from("complete-attachment");
		const storagePath = join(sha256(correct), "10");
		const target = join(directory, storagePath);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, correct.subarray(0, 4));

		const imported = await fetchAttachments(
			createClient(correct, attachment(correct.length)),
			directory,
		);

		expect(imported?.sha256).toBe(sha256(correct));
		expect(
			await readFile(join(directory, imported?.storagePath ?? "")),
		).toEqual(correct);
	});
});
