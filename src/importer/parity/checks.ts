import type { CheckResult, CheckStatus } from "./types.ts";

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
		status: status ?? (unique.length === 0 ? "OK" : "MISMATCH"),
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

export function compareCount(
	name: string,
	live: number,
	database: number,
	details: string[] = [],
): CheckResult {
	return check(name, live, database, details);
}

export function compareMaps(
	name: string,
	live: Map<string, number>,
	database: Map<string, number>,
): CheckResult {
	const keys = new Set([...live.keys(), ...database.keys()]);
	const details: string[] = [];
	let liveTotal = 0;
	let databaseTotal = 0;
	for (const key of keys) {
		const liveValue = live.get(key) ?? 0;
		const databaseValue = database.get(key) ?? 0;
		liveTotal += liveValue;
		databaseTotal += databaseValue;
		if (liveValue !== databaseValue) details.push(key);
	}
	return check(name, liveTotal, databaseTotal, details);
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
