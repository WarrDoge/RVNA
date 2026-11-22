import type { CheckResult, CheckStatus } from "./types.ts";

/** The columns each optional wiki parity query reads. */
export const wikiRequiredColumns = {
	page_versions: ["source_id", "page_id"],
	page_comments: ["page_id", "inline"],
	page_attachments: ["page_id", "source_id", "size", "sha256"],
	page_labels: ["page_id", "label"],
	page_restrictions: ["page_id", "operation", "group_name", "user_id"],
	space_permissions: [
		"space_id",
		"permission",
		"anonymous",
		"group_name",
		"user_id",
	],
	page_watchers: ["page_id", "source_id"],
	space_watchers: ["space_id", "source_id"],
	page_likes: ["page_id", "source_id"],
} satisfies Record<string, string[]>;

export function sorted(values: Iterable<string>) {
	return [...new Set(values)].sort();
}

export function symmetricDifference(
	left: Iterable<string>,
	right: Iterable<string>,
) {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	const result: string[] = [];
	for (const value of leftSet) if (!rightSet.has(value)) result.push(value);
	for (const value of rightSet) if (!leftSet.has(value)) result.push(value);
	return result.sort();
}

export function check(
	name: string,
	live: number | string | null,
	database: number | string | null,
	details: string[] = [],
	status?: CheckStatus,
): CheckResult {
	const unique = [...new Set(details)].sort();
	return {
		name,
		live,
		database,
		status:
			status ?? (unique.length === 0 && live === database ? "OK" : "MISMATCH"),
		details: unique,
	};
}

export function skipped(name: string, reason: string): CheckResult {
	return {
		name,
		live: null,
		database: null,
		status: "SKIPPED",
		details: [],
		note: reason,
	};
}

export function compareSets(
	name: string,
	live: Iterable<string>,
	database: Iterable<string>,
): CheckResult {
	const liveValues = sorted(live);
	const databaseValues = sorted(database);
	return check(
		name,
		liveValues.length,
		databaseValues.length,
		symmetricDifference(liveValues, databaseValues),
	);
}

export function compareSetsByKey(
	name: string,
	live: Map<string, Iterable<string>>,
	database: Map<string, Iterable<string>>,
): CheckResult {
	const keys = new Set([...live.keys(), ...database.keys()]);
	const details: string[] = [];
	let liveTotal = 0;
	let databaseTotal = 0;
	for (const key of keys) {
		const liveValues = sorted(live.get(key) ?? []);
		const databaseValues = sorted(database.get(key) ?? []);
		liveTotal += liveValues.length;
		databaseTotal += databaseValues.length;
		for (const value of symmetricDifference(liveValues, databaseValues)) {
			details.push(`${key}:${value}`);
		}
	}
	return check(name, liveTotal, databaseTotal, details);
}
