import { expect, test } from "vitest";
import { cfdQuery } from "../src/lib/server/reports/schemas.ts";

test("the cumulative flow query rejects a date that is not an ISO day", () => {
	expect(cfdQuery.safeParse({}).success).toBe(true);
	expect(
		cfdQuery.safeParse({ from: "2026-01-01", to: "2026-01-31" }).success,
	).toBe(true);
	expect(cfdQuery.safeParse({ from: "not-a-date" }).success).toBe(false);
	expect(cfdQuery.safeParse({ to: "2026-02-30" }).success).toBe(false);
});
