import { afterAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import { loadCatalog } from "../src/lib/server/jql/catalog.ts";
import { ALL_PROJECTS, compileJql } from "../src/lib/server/jql/compile.ts";
import { JqlError, parseJql } from "../src/lib/shared/jql/index.ts";

const TOKENS = [
	"project",
	"status",
	"assignee",
	"summary",
	"labels",
	"created",
	"cf[10106]",
	'"Story Points"',
	"AND",
	"OR",
	"NOT",
	"!",
	"IN",
	"IS",
	"WAS",
	"CHANGED",
	"FROM",
	"TO",
	"BY",
	"AFTER",
	"BEFORE",
	"ON",
	"DURING",
	"ORDER",
	"BY",
	"ASC",
	"DESC",
	"=",
	"!=",
	"~",
	"!~",
	">",
	">=",
	"<",
	"<=",
	"(",
	")",
	",",
	'"done"',
	'"a b"',
	"-7d",
	"42",
	"currentUser()",
	"startOfMonth(-1)",
	'membersOf("g")',
	"EMPTY",
	"NULL",
	"foo",
	"cf[",
	"]",
	'"',
];

function mulberry32(seed: number) {
	let state = seed;
	return () => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

afterAll(async () => {
	await pool.end();
});

describe("JQL fuzz", () => {
	test("2000 random token sequences only ever raise typed JQL errors", async () => {
		const random = mulberry32(0x5eed);
		const catalog = await loadCatalog();
		const user = {
			id: "00000000-0000-0000-0000-000000000000",
			username: "fuzz",
		};
		let parsed = 0;
		let rejected = 0;
		let compiled = 0;

		const pick = () => TOKENS[Math.floor(random() * TOKENS.length)] as string;
		const gap = () => (random() < 0.1 ? "" : " ");

		for (let caseIndex = 0; caseIndex < 2000; caseIndex++) {
			let input: string;
			if (random() < 0.55) {
				const clause = () =>
					[
						"project",
						"status",
						"summary",
						"labels",
						"cf[10106]",
						'"Story Points"',
					][Math.floor(random() * 6)] +
					gap() +
					["=", "!=", "~", "!~", ">", ">=", "<", "<=", "in", "is"][
						Math.floor(random() * 10)
					] +
					gap() +
					[
						'"done"',
						"42",
						"foo",
						"-7d",
						"currentUser()",
						"EMPTY",
						"(a, b)",
						"startOfMonth(-1)",
						'membersOf("g")',
					][Math.floor(random() * 9)];
				let text = clause();
				const extra = Math.floor(random() * 3);
				for (let step = 0; step < extra; step++) {
					text += ` ${random() < 0.5 ? "AND" : "OR"} ${clause()}`;
				}
				if (random() < 0.2) text = `NOT (${text})`;
				if (random() < 0.2) {
					text += ` ORDER BY ${["created", "updated", "Rank", '"Story Points"'][Math.floor(random() * 4)]} ${random() < 0.5 ? "ASC" : "DESC"}`;
				}
				input = text;
			} else {
				const length = 1 + Math.floor(random() * 12);
				const tokens: string[] = [];
				for (let step = 0; step < length; step++) tokens.push(pick());
				input = tokens.join(" ");
			}

			let query: ReturnType<typeof parseJql>;
			try {
				query = parseJql(input);
			} catch (error) {
				expect(error).toBeInstanceOf(JqlError);
				expect((error as JqlError).message.length).toBeGreaterThan(0);
				expect((error as JqlError).line).toBeGreaterThan(0);
				rejected += 1;
				continue;
			}
			parsed += 1;

			try {
				await compileJql(query, {
					user,
					catalog,
					now: new Date(0),
					visibleProjectIds: ALL_PROJECTS,
				});
				compiled += 1;
			} catch (error) {
				expect(error).toBeInstanceOf(JqlError);
			}
		}

		// The generator must actually exercise both paths.
		expect(parsed).toBeGreaterThan(100);
		expect(rejected).toBeGreaterThan(100);
		expect(compiled).toBeGreaterThan(0);
	});
});
