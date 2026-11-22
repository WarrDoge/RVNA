import { db } from "../db.ts";
import { projects } from "../schema.ts";

export interface IssueRef {
	id: string;
	key: string;
	projectId: string;
	summary: string;
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Issue keys referenced by a branch name, commit message or merge request title.
 * Matching ignores case (branch names are lowercased by many teams) but only
 * project keys that exist in RVNA are considered. The returned keys are
 * uppercased, de-duplicated and in the order they first appear.
 */
export function extractIssueKeys(
	text: string,
	projectKeys: Iterable<string>,
): string[] {
	const keys = [
		...new Set(
			[...projectKeys]
				.map((key) => key.toUpperCase())
				.filter((key) => key.trim() !== ""),
		),
	];
	if (keys.length === 0 || text === "") return [];

	const pattern = new RegExp(
		`(?<![A-Za-z0-9_])(${keys
			.sort((left, right) => right.length - left.length)
			.map(escapeRegExp)
			.join("|")})-(\\d+)(?![A-Za-z0-9_])`,
		"gi",
	);

	const found: string[] = [];
	for (const match of text.matchAll(pattern)) {
		const key = `${match[1].toUpperCase()}-${match[2].replace(/^0+(?=\d)/, "")}`;
		if (!found.includes(key)) found.push(key);
	}
	return found;
}

export async function loadProjectKeys(): Promise<string[]> {
	const rows = await db.select({ key: projects.key }).from(projects);
	return rows.map((row) => row.key);
}

export function summarySlug(summary: string, maxLength = 40) {
	const slug = summary
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLength)
		.replace(/-+$/g, "");
	return slug || "task";
}

export function branchNameFor(key: string, summary: string) {
	return `${key.toUpperCase()}-${summarySlug(summary)}`;
}
