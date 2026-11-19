import { afterAll, describe, expect, test } from "vitest";
import { rankBetween, ranksBetween } from "../src/lib/server/rank.ts";

const JIRA_FIRST = "0|hzzzzz:";
const JIRA_SECOND = "0|i00000:";

afterAll(async () => {
	const { pool } = await import("../src/lib/server/db.ts");
	await pool.end();
});

describe("rankBetween", () => {
	test("returns a middle rank for an empty list", () => {
		expect(rankBetween(null, null)).toBe("m");
	});

	test("sorts before the first imported rank and after the last", () => {
		const before = rankBetween(null, JIRA_FIRST);
		const after = rankBetween(JIRA_SECOND, null);
		expect(before < JIRA_FIRST).toBe(true);
		expect(after > JIRA_SECOND).toBe(true);
	});

	test("sorts between two imported Jira ranks", () => {
		const rank = rankBetween(JIRA_FIRST, JIRA_SECOND);
		expect(JIRA_FIRST < rank).toBe(true);
		expect(rank < JIRA_SECOND).toBe(true);
	});

	test("keeps order across many inserts at the same position", () => {
		let before = JIRA_FIRST;
		const inserted: string[] = [];
		for (let index = 0; index < 200; index += 1) {
			const rank = rankBetween(before, JIRA_SECOND);
			expect(before < rank).toBe(true);
			expect(rank < JIRA_SECOND).toBe(true);
			inserted.push(rank);
			before = rank;
		}
		const sorted = [...inserted].sort();
		expect(sorted).toEqual(inserted);
		expect(new Set(inserted).size).toBe(inserted.length);
	});

	test("keeps order when inserting at the head many times", () => {
		let after = JIRA_FIRST;
		const inserted: string[] = [];
		for (let index = 0; index < 100; index += 1) {
			const rank = rankBetween(null, after);
			expect(rank < after).toBe(true);
			inserted.push(rank);
			after = rank;
		}
		expect(inserted).toEqual([...inserted].sort().reverse());
	});

	test("keeps order when inserting at the tail many times", () => {
		let before = JIRA_SECOND;
		for (let index = 0; index < 100; index += 1) {
			const rank = rankBetween(before, null);
			expect(before < rank).toBe(true);
			before = rank;
		}
	});

	test("handles adjacent characters by descending", () => {
		const rank = rankBetween("ab", "ac");
		expect("ab" < rank).toBe(true);
		expect(rank < "ac").toBe(true);
		expect(rankBetween("a", "a!") < "a!").toBe(true);
		expect(rankBetween("a", "a!") > "a").toBe(true);
	});

	test("generates a group between the same neighbours", () => {
		const ranks = ranksBetween("b", "c", 50);
		expect(ranks).toHaveLength(50);
		expect(ranks[0] > "b").toBe(true);
		expect(ranks[49] < "c").toBe(true);
		expect(ranks).toEqual([...ranks].sort());
	});

	test("rejects bounds in the wrong order", () => {
		expect(() => rankBetween(JIRA_SECOND, JIRA_FIRST)).toThrow(
			"Rank bounds are not in order",
		);
		expect(() => rankBetween("a", "a")).toThrow("Rank bounds are not in order");
	});
});

describe("PostgreSQL ordering", () => {
	test("orders generated ranks next to imported Jira ranks", async () => {
		const { pool } = await import("../src/lib/server/db.ts");
		const ranks = [
			rankBetween(null, JIRA_FIRST),
			JIRA_FIRST,
			rankBetween(JIRA_FIRST, JIRA_SECOND),
			JIRA_SECOND,
			rankBetween(JIRA_SECOND, null),
		];
		const result = await pool.query<{ rank: string }>(
			`select rank from unnest($1::text[]) with ordinality as t(rank, position)
			 order by rank collate "C"`,
			[ranks],
		);
		expect(result.rows.map((row) => row.rank)).toEqual(
			[...ranks].sort((left, right) => (left < right ? -1 : 1)),
		);
	});
});
