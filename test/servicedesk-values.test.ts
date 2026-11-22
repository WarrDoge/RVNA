import { expect, test } from "vitest";
import {
	customDate,
	customText,
} from "../src/lib/server/servicedesk/values.ts";

test("customText renders the shapes Jira stores", () => {
	expect(customText(null)).toBe("");
	expect(customText("  Text  ")).toBe("Text");
	expect(customText(42)).toBe("42");
	expect(customText(true)).toBe("true");
	expect(customText(["One", "Two"])).toBe("One, Two");
	expect(customText({ displayName: "Alex Example" })).toBe("Alex Example");
	expect(customText({ name: "ops" })).toBe("ops");
	expect(customText({ value: "Parent", child: { value: "Child" } })).toBe(
		"Parent / Child",
	);
});

test("customDate accepts only an unambiguous instant", () => {
	expect(customDate("2024-01-15T10:00:00Z")).toBe("2024-01-15T10:00:00.000Z");
	expect(customDate("2024-01-15T10:00:00+02:00")).toBe(
		"2024-01-15T08:00:00.000Z",
	);
	expect(customDate("2024-01-15 10:00:00Z")).toBe("2024-01-15T10:00:00.000Z");
	expect(customDate("2024-01-15")).toBeNull();
	expect(customDate("2024")).toBeNull();
	expect(customDate("01/05/2024")).toBeNull();
	expect(customDate("Jan 5 2024")).toBeNull();
	expect(customDate("2024-01-15T10:00:00")).toBeNull();
	expect(customDate("")).toBeNull();
	expect(customDate(null)).toBeNull();
});
