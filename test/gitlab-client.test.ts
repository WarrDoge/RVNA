import { expect, test } from "vitest";
import {
	type FetchLike,
	GitlabApi,
	testConnection,
} from "../src/lib/server/gitlab/client.ts";

function response(
	body: unknown,
	options: { status?: number; nextPage?: string } = {},
): Awaited<ReturnType<FetchLike>> {
	const status = options.status ?? 200;
	return {
		ok: status < 400,
		status,
		headers: {
			get: (name: string) =>
				name === "x-next-page" ? (options.nextPage ?? "") : null,
		},
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

test("a non-list page is rejected with a descriptive error", async () => {
	const api = new GitlabApi(
		"https://gitlab.example.test",
		"glpat-test",
		async () => response({ message: "not a list" }),
	);
	await expect(api.branches(7)).rejects.toThrow(/non-list response/);
});

test("a page carries its items and the next page", async () => {
	const calls: string[] = [];
	const api = new GitlabApi(
		"https://gitlab.example.test",
		"glpat-test",
		async (url) => {
			calls.push(url);
			return response([{ name: "main", commit: null }], { nextPage: "2" });
		},
	);
	const page = await api.branches(7);
	expect(page.items).toEqual([{ name: "main", commit: null }]);
	expect(page.nextPage).toBe(2);
	expect(calls[0]).toBe(
		"https://gitlab.example.test/api/v4/projects/7/repository/branches?per_page=100&page=1",
	);
});

test("merge requests are bounded by the update time", async () => {
	const calls: string[] = [];
	const api = new GitlabApi(
		"https://gitlab.example.test",
		"glpat-test",
		async (url) => {
			calls.push(url);
			return response([]);
		},
	);
	await api.mergeRequests(7, "2026-03-03T00:00:00.000Z", 2);
	expect(calls[0]).toContain("updated_after=2026-03-03T00%3A00%3A00.000Z");
	expect(calls[0]).toContain("per_page=100&page=2");
});

test("the connection check uses the version endpoint", async () => {
	const calls: string[] = [];
	const result = await testConnection(
		"https://gitlab.example.test/",
		"glpat-test",
		async (url) => {
			calls.push(url);
			return response({ version: "17.0.0" });
		},
	);
	expect(result).toEqual({ version: "17.0.0" });
	expect(calls[0]).toBe("https://gitlab.example.test/api/v4/version");
});
