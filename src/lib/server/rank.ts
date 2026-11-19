const MIN_CHAR = 32;
const MAX_CHAR = 126;
const MIDDLE = "m";

function char(code: number) {
	return String.fromCharCode(code);
}

function below(value: string): string {
	if (value === "") {
		throw new Error("No rank can sort before an empty rank");
	}
	const first = value.charCodeAt(0);
	if (first > MIN_CHAR) {
		const rest = value.length > 1 ? value.slice(1) : char(MAX_CHAR);
		return char(first - 1) + rest;
	}
	return value[0] + below(value.slice(1));
}

function above(value: string): string {
	if (value === "") return MIDDLE;
	const last = value.charCodeAt(value.length - 1);
	if (last < MAX_CHAR) {
		return value.slice(0, -1) + char(last + 1);
	}
	return value + MIDDLE;
}

function midpoint(before: string, after: string): string {
	let index = 0;
	while (
		index < before.length &&
		index < after.length &&
		before[index] === after[index]
	) {
		index += 1;
	}

	if (index === before.length) {
		return before + below(after.slice(index));
	}

	const beforeCode = before.charCodeAt(index);
	const afterCode = after.charCodeAt(index);
	if (beforeCode >= afterCode) {
		throw new Error("Rank bounds are not in order");
	}
	if (afterCode - beforeCode > 1) {
		return before.slice(0, index) + char(beforeCode + 1);
	}
	return (
		before.slice(0, index) + before[index] + above(before.slice(index + 1))
	);
}

/**
 * Returns a rank that sorts strictly between `before` and `after` in byte
 * order, so imported Jira lexoranks and generated ranks share one sequence.
 * A null bound means the start or the end of the list.
 */
export function rankBetween(
	before: string | null,
	after: string | null,
): string {
	if (before !== null && after !== null && before >= after) {
		throw new Error("Rank bounds are not in order");
	}
	if (before === null && after === null) return MIDDLE;
	if (before === null) return below(after as string);
	if (after === null) return above(before);
	return midpoint(before, after);
}

/** Ranks for `count` issues inserted together at the same position. */
export function ranksBetween(
	before: string | null,
	after: string | null,
	count: number,
): string[] {
	if (count <= 0) return [];
	const ranks: string[] = [];
	let previous = before;
	for (let index = 0; index < count; index += 1) {
		const rank = rankBetween(previous, after);
		ranks.push(rank);
		previous = rank;
	}
	return ranks;
}
