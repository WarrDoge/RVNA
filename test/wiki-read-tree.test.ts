import { expect, test, vi } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { loadPageWithTree } from "../src/lib/server/wiki/read.ts";
import { getSpaceTree } from "../src/lib/server/wiki/service.ts";

vi.mock("../src/lib/server/wiki/service.ts", () => ({
	getSpaceTree: vi.fn(async (_actor: unknown, key: string) => [
		{ id: `tree-of-${key}` },
	]),
}));

const actor = { id: "u" } as CurrentUser;
const pageIn = (key: string) => ({ id: "p", space: { key } }) as never;

test("the tree is requested while the page is still loading", async () => {
	const calls: string[] = [];
	vi.mocked(getSpaceTree).mockClear();
	vi.mocked(getSpaceTree).mockImplementationOnce(async (_actor, key) => {
		calls.push("tree");
		return [{ id: `tree-of-${key}` }] as never;
	});
	const result = await loadPageWithTree(actor, "ABC", async () => {
		calls.push("page");
		await Promise.resolve();
		return pageIn("ABC");
	});
	expect(calls).toEqual(["page", "tree"]);
	expect(result.tree).toEqual([{ id: "tree-of-ABC" }]);
	expect(getSpaceTree).toHaveBeenCalledTimes(1);
});

test("a page that lives in another space gets the tree of its own space", async () => {
	vi.mocked(getSpaceTree).mockClear();
	const result = await loadPageWithTree(actor, "ABC", async () =>
		pageIn("XYZ"),
	);
	expect(result.tree).toEqual([{ id: "tree-of-XYZ" }]);
	expect(getSpaceTree).toHaveBeenCalledTimes(2);
});

test("a page that cannot be loaded rejects, whatever the tree did", async () => {
	vi.mocked(getSpaceTree).mockRejectedValueOnce(new Error("no space"));
	await expect(
		loadPageWithTree(actor, "ABC", async () => {
			throw new Error("no page");
		}),
	).rejects.toThrow("no page");
});
