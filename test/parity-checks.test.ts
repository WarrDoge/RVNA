import { describe, expect, test } from "vitest";
import { check } from "../src/importer/parity/checks.ts";

describe("parity check status", () => {
	test("unequal counts without details are a mismatch", () => {
		expect(check("counts", 5, 7)).toEqual({
			name: "counts",
			live: 5,
			database: 7,
			status: "MISMATCH",
			details: [],
		});
	});

	test("equal counts without details are OK", () => {
		expect(check("counts", 5, 5).status).toBe("OK");
	});

	test("an explicit status overrides the counts", () => {
		expect(check("counts", 5, 7, [], "OK").status).toBe("OK");
	});
});
