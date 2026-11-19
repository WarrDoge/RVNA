import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type pg from "pg";
import { check, skipped } from "./checks.ts";
import type { CheckResult, ParityScope, TableSet } from "./types.ts";

export interface AttachmentFileRow {
	sourceId: string;
	storagePath: string;
	size: number;
	sha256: string;
}

export interface AttachmentFileRows {
	jira: AttachmentFileRow[];
	wiki: AttachmentFileRow[];
}

export async function loadAttachmentFiles(
	pool: pg.Pool,
	tables: TableSet,
): Promise<AttachmentFileRows> {
	const jira = await pool.query<{
		source_id: string;
		storage_path: string;
		size: number;
		sha256: string;
	}>(
		"select source_id, storage_path, size, sha256 from attachments order by source_id",
	);
	const wiki = tables.has("page_attachments")
		? await pool.query<{
				source_id: string;
				storage_path: string;
				size: number;
				sha256: string;
			}>(
				"select source_id, storage_path, size, sha256 from page_attachments order by source_id",
			)
		: { rows: [] };
	return {
		jira: jira.rows.map((row) => ({
			sourceId: row.source_id,
			storagePath: row.storage_path,
			size: row.size,
			sha256: row.sha256,
		})),
		wiki: wiki.rows.map((row) => ({
			sourceId: row.source_id,
			storagePath: row.storage_path,
			size: row.size,
			sha256: row.sha256,
		})),
	};
}

async function hashFile(path: string) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) {
		hash.update(chunk as Buffer);
	}
	return hash.digest("hex");
}

async function mapLimit<T>(
	values: T[],
	limit: number,
	fn: (value: T) => Promise<void>,
) {
	let index = 0;
	const workers = Array.from(
		{ length: Math.min(limit, values.length) },
		async () => {
			for (;;) {
				const current = index++;
				if (current >= values.length) return;
				await fn(values[current] as T);
			}
		},
	);
	await Promise.all(workers);
}

async function checkFiles(
	name: string,
	hashName: string,
	rows: AttachmentFileRow[],
	root: string,
	skipHash: boolean,
): Promise<CheckResult[]> {
	const details: string[] = [];
	const hashDetails: string[] = [];
	let verified = 0;
	let hashed = 0;
	await mapLimit(rows, 4, async (row) => {
		const target = resolve(root, row.storagePath);
		const insideRoot = target === root || target.startsWith(`${root}${sep}`);
		if (!insideRoot) {
			details.push(row.sourceId);
			hashDetails.push(row.sourceId);
			return;
		}
		try {
			const info = await stat(target);
			if (!info.isFile() || info.size !== row.size) {
				details.push(row.sourceId);
			} else {
				verified++;
				if (!skipHash) {
					const sha256 = await hashFile(target);
					if (sha256 === row.sha256) {
						hashed++;
					} else {
						hashDetails.push(row.sourceId);
					}
				}
			}
		} catch {
			details.push(row.sourceId);
			hashDetails.push(row.sourceId);
		}
	});
	const result = check(name, rows.length, verified, details);
	const hashResult = skipHash
		? skipped(hashName, "--skip-hash")
		: check(hashName, rows.length, hashed, hashDetails);
	return [result, hashResult];
}

export async function fileChecks(
	rows: AttachmentFileRows,
	attachmentsDir: string,
	skipHash: boolean,
	scope: ParityScope = "all",
): Promise<CheckResult[]> {
	const root = resolve(attachmentsDir);
	const checks: CheckResult[] = [];
	if (scope !== "confluence") {
		checks.push(
			...(await checkFiles(
				"files.jira.attachments",
				"files.jira.sha256",
				rows.jira,
				root,
				skipHash,
			)),
		);
	}
	if (scope !== "jira") {
		checks.push(
			...(await checkFiles(
				"files.wiki.attachments",
				"files.wiki.sha256",
				rows.wiki,
				root,
				skipHash,
			)),
		);
	}
	return checks;
}
