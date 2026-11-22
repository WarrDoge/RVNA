import { expect, test } from "vitest";
import { branchUrl, type Repository } from "../src/lib/server/gitlab/store.ts";

const repository = {
	webUrl: "https://gitlab.example.test/team/service",
} as Repository;

test("a branch URL keeps namespace slashes and encodes the rest", () => {
	expect(branchUrl(repository, "feature/login")).toBe(
		"https://gitlab.example.test/team/service/-/tree/feature/login",
	);
	expect(branchUrl(repository, "fix #1?")).toBe(
		"https://gitlab.example.test/team/service/-/tree/fix%20%231%3F",
	);
	expect(branchUrl(repository, "release/2026.1")).toBe(
		"https://gitlab.example.test/team/service/-/tree/release/2026.1",
	);
});
