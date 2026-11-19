import { expect, test } from "vitest";
import { resultPath } from "../src/lib/shell/quicksearch.ts";

const page = {
	id: "00000000-0000-4000-8000-000000000001",
	title: "A page",
	spaceKey: "SPACE",
	spaceName: "Space",
};

test("the quick search Enter target includes page results", () => {
	expect(
		resultPath(
			{
				issues: [],
				projects: [],
				pages: [page],
			},
			0,
		),
	).toBe(`/pages/${page.id}`);
});

test("issue and project results keep their order before pages", () => {
	const results = {
		issues: [
			{
				id: "issue-id",
				key: "ABC-1",
				summary: "An issue",
				type: { id: "t", name: "Task", subtask: false, iconUrl: null },
				status: { id: "s", name: "To Do", category: "new" as const },
			},
		],
		projects: [{ key: "ABC", name: "Project", avatarUrl: null }],
		pages: [page],
	};
	expect(resultPath(results, 0)).toBe("/browse/ABC-1");
	expect(resultPath(results, 1)).toBe("/projects/ABC/issues");
	expect(resultPath(results, 2)).toBe(`/pages/${page.id}`);
	expect(resultPath(results, 3)).toBeNull();
});
