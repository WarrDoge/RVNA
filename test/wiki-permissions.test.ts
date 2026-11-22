import { describe, expect, test } from "vitest";
import { mapSpacePermission } from "../src/importer/wiki-permissions.ts";
import { SPACE_PERMISSIONS } from "../src/lib/server/wiki-edit/access.ts";

describe("space permission mapping", () => {
	test("maps every permission the app knows", () => {
		for (const permission of SPACE_PERMISSIONS) {
			const targetType =
				permission === "create" || permission === "delete" ? "page" : "space";
			expect(mapSpacePermission(targetType, permission)).toBe(permission);
		}
	});
});
