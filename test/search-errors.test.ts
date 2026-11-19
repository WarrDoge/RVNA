import { expect, test, vi } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { HttpError } from "../src/lib/server/http.ts";

const { globalSearch } = vi.hoisted(() => ({ globalSearch: vi.fn() }));

vi.mock("../src/lib/server/global-search.ts", () => ({ globalSearch }));

const { load } = await import("../src/routes/search/+page.server.ts");

const actor: CurrentUser = {
	id: "00000000-0000-0000-0000-000000000000",
	username: "search-errors",
	displayName: "Search errors",
	email: null,
	avatarUrl: null,
	groups: [],
	isAdmin: false,
	mustChangePassword: false,
	hasPassword: false,
};

function event(query = "secret") {
	return {
		locals: { user: actor },
		params: {},
		route: { id: "/search" },
		url: new URL(`http://localhost/search?q=${query}`),
	} as never;
}

test("a domain error message is shown under the search box", async () => {
	globalSearch.mockRejectedValueOnce(
		new HttpError(400, "Error in the JQL Query: bad field"),
	);
	const data = (await load(event())) as { error: string | null };
	expect(data.error).toBe("Error in the JQL Query: bad field");
});

test("an internal error is not copied into the page data", async () => {
	globalSearch.mockRejectedValueOnce(
		new Error("relation search_secret_table does not exist"),
	);
	await expect(load(event())).rejects.toThrow(
		"relation search_secret_table does not exist",
	);
});
