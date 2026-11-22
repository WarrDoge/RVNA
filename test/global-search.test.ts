import { expect, test, vi } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { JqlError } from "../src/lib/shared/jql/index.ts";

const mocks = vi.hoisted(() => ({
	searchPages: vi.fn(),
	loadNavigatorPage: vi.fn(),
}));

vi.mock("../src/lib/server/search-pages.ts", () => ({
	searchPages: mocks.searchPages,
}));

vi.mock("../src/lib/server/navigator/service.ts", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../src/lib/server/navigator/service.ts")
		>();
	return { ...actual, loadNavigatorPage: mocks.loadNavigatorPage };
});

const { globalSearch } = await import("../src/lib/server/global-search.ts");

const user: CurrentUser = {
	id: "00000000-0000-0000-0000-000000000000",
	username: "global-search",
	displayName: "Global search",
	email: null,
	avatarUrl: null,
	groups: [],
	isAdmin: false,
	mustChangePassword: false,
	hasPassword: false,
};

test("an empty query echoes the requested page", async () => {
	const result = await globalSearch(user, {
		q: "",
		startAt: 25,
		maxResults: 10,
	});

	expect(result).toEqual({
		issues: { total: 0, startAt: 25, maxResults: 10, items: [] },
		pages: { total: 0, items: [] },
	});
	expect(mocks.searchPages).not.toHaveBeenCalled();
	expect(mocks.loadNavigatorPage).not.toHaveBeenCalled();
});

test("a JQL failure is answered as a 400", async () => {
	mocks.searchPages.mockResolvedValueOnce({ total: 0, pages: [] });
	mocks.loadNavigatorPage.mockRejectedValueOnce(new JqlError("bad query"));

	await expect(
		globalSearch(user, { q: "login", startAt: 0, maxResults: 10 }),
	).rejects.toMatchObject({
		status: 400,
		message: "Error in the JQL Query: bad query",
	});
});

test("the page and issue searches run together", async () => {
	let releasePages!: (value: unknown) => void;
	let releaseIssues!: (value: unknown) => void;
	mocks.searchPages.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				releasePages = resolve;
			}),
	);
	mocks.loadNavigatorPage.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				releaseIssues = resolve;
			}),
	);

	const result = globalSearch(user, {
		q: "login",
		startAt: 5,
		maxResults: 10,
	});

	expect(mocks.searchPages).toHaveBeenCalledOnce();
	expect(mocks.loadNavigatorPage).toHaveBeenCalledOnce();

	releasePages({
		total: 1,
		pages: [
			{
				id: "page-1",
				title: "Login",
				spaceKey: "DOC",
				spaceName: "Docs",
				updated: null,
			},
		],
	});
	releaseIssues({
		total: 1,
		startAt: 5,
		maxResults: 10,
		issues: [
			{
				id: "00000000-0000-4000-8000-000000000001",
				key: "DEMO-1",
				summary: "Login",
				type: { id: "type", name: "Task", subtask: false, iconUrl: null },
				status: { id: "status", name: "To Do", category: "new" },
				updated: null,
			},
		],
	});

	await expect(result).resolves.toEqual({
		issues: {
			total: 1,
			startAt: 5,
			maxResults: 10,
			items: [
				{
					id: "00000000-0000-4000-8000-000000000001",
					key: "DEMO-1",
					summary: "Login",
					type: { id: "type", name: "Task", subtask: false, iconUrl: null },
					status: { id: "status", name: "To Do", category: "new" },
					updated: null,
				},
			],
		},
		pages: {
			total: 1,
			items: [
				{
					id: "page-1",
					title: "Login",
					spaceKey: "DOC",
					spaceName: "Docs",
					updated: null,
				},
			],
		},
	});
});
