import { expect, test } from "vitest";
import {
	downloadParams,
	pageQuery,
	searchQuery,
} from "../src/lib/server/wiki/schemas.ts";

test("a page version must be a positive number", () => {
	expect(pageQuery.safeParse({ version: "1" }).success).toBe(true);
	expect(pageQuery.safeParse({ version: "" }).success).toBe(false);
	expect(pageQuery.safeParse({ version: "0" }).success).toBe(false);
	expect(pageQuery.safeParse({ version: "-1" }).success).toBe(false);
});

test("a search date must be a real date", () => {
	expect(searchQuery.safeParse({ from: "2024-01-01" }).success).toBe(true);
	expect(searchQuery.safeParse({ from: "2024-01-01T10:00:00Z" }).success).toBe(
		true,
	);
	expect(searchQuery.safeParse({ from: "" }).success).toBe(true);
	expect(searchQuery.safeParse({ from: "not-a-date" }).success).toBe(false);
	expect(searchQuery.safeParse({ from: "2024-02-30" }).success).toBe(false);
	expect(searchQuery.safeParse({ to: "2024-13-01" }).success).toBe(false);
});

test("an attachment download name has the same limit as its API name", () => {
	expect(
		downloadParams.safeParse({ pageId: "1", fileName: "a".repeat(1000) })
			.success,
	).toBe(true);
	expect(
		downloadParams.safeParse({ pageId: "1", fileName: "a".repeat(1001) })
			.success,
	).toBe(false);
});
