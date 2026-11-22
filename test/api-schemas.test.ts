import { expect, test } from "vitest";
import {
	idNameRefSchema,
	issueDetailSchema,
	versionSchema,
} from "../src/lib/server/api-schemas.ts";

const id = "00000000-0000-4000-8000-000000000001";

test("version dates are ISO dates", () => {
	const base = {
		id,
		name: "1.0",
		description: null,
		released: false,
		archived: false,
		startDate: null,
		releaseDate: null,
	};
	expect(
		versionSchema.safeParse({ ...base, startDate: "2026-01-01" }).success,
	).toBe(true);
	expect(
		versionSchema.safeParse({ ...base, startDate: "2026-01-01T00:00:00Z" })
			.success,
	).toBe(false);
	expect(
		versionSchema.safeParse({ ...base, releaseDate: "not a date" }).success,
	).toBe(false);
});

test("the issue due date is an ISO date", () => {
	expect(issueDetailSchema.shape.dueDate.safeParse("2026-01-01").success).toBe(
		true,
	);
	expect(
		issueDetailSchema.shape.dueDate.safeParse("2026-01-01T00:00:00Z").success,
	).toBe(false);
});

test("the shared id and name reference keeps both fields", () => {
	expect(idNameRefSchema.parse({ id, name: "Backend" })).toEqual({
		id,
		name: "Backend",
	});
});
