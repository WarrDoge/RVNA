import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("the wiki editor uses the shared session-expired redirect", () => {
	const source = readFileSync(
		"src/lib/wiki/editor/edit-session.svelte.ts",
		"utf8",
	);
	expect(source).not.toContain("/auth/login");
	expect(source).toContain("redirectToLogin");
});
