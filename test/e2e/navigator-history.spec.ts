import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
} from "../fixtures/project.ts";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const key = fixtureKey(run);
const filterName = `Navigator review ${run}`;

let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await client.query(
		`delete from user_preferences
		 where user_id in (select id from users where username = 'dev')`,
	);
	await createProjectFixture(client, {
		run,
		key,
		name: `Navigator review ${run}`,
		issues: [
			{ summary: `Navigator review issue 01 ${run}` },
			{ summary: `Navigator review issue 02 ${run}` },
			{ summary: `Navigator review issue 03 ${run}` },
			{ summary: `Navigator review issue 04 ${run}` },
		],
	});
});

test.afterAll(async () => {
	if (client) {
		await client.query("delete from filters where name like $1", [
			`${filterName}%`,
		]);
		await dropProjectFixture(client, run);
		await client.query(
			`delete from user_preferences
			 where user_id in (select id from users where username = 'dev')`,
		);
		await client.end();
	}
});

function jqlFromUrl(url: string) {
	return new URL(url).searchParams.get("jql") ?? "";
}

async function login(page: import("@playwright/test").Page) {
	await page.goto("/auth/login?returnTo=/issues/");
	await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
}

test("a new search pushes history and Back restores the previous query in the input", async ({
	page,
}) => {
	await login(page);
	const first = `project = ${key} ORDER BY key ASC`;
	const second = `project = ${key} ORDER BY key DESC`;
	await page.goto(`/issues/?jql=${encodeURIComponent(first)}&view=list`);
	const jql = page.getByRole("textbox", { name: "Advanced search" });
	await expect(jql).toHaveValue(first);

	await jql.fill(second);
	await jql.press("Enter");
	await expect.poll(() => jqlFromUrl(page.url())).toBe(second);

	await page.goBack();
	await expect.poll(() => jqlFromUrl(page.url())).toBe(first);
	await expect(jql).toHaveValue(first);
});

test("a recent-issues search cannot overwrite a newer query", async ({
	page,
}) => {
	await login(page);
	let recentCalls = 0;
	await page.route("**/api/issues/recent?*", async (route) => {
		recentCalls += 1;
		await new Promise((resolve) => setTimeout(resolve, 1500));
		await route.fulfill({ json: { issues: [] } });
	});

	await page.goto(
		`/issues/?jql=${encodeURIComponent(`project = ${key} ORDER BY key ASC`)}&view=list`,
	);
	await expect(page.locator(".navigator")).toHaveAttribute(
		"data-hydrated",
		"true",
	);
	await page.evaluate(() => {
		const buttons = Array.from(document.querySelectorAll("button"));
		const recent = buttons.find(
			(button) => button.textContent?.trim() === "Viewed recently",
		);
		const all = buttons.find(
			(button) => button.textContent?.trim() === "All issues",
		);
		recent?.click();
		all?.click();
	});

	await expect.poll(() => jqlFromUrl(page.url())).toBe("ORDER BY key DESC");
	await page.waitForTimeout(1800);
	expect(jqlFromUrl(page.url())).toBe("ORDER BY key DESC");
	expect(recentCalls).toBe(0);
});

test("changing the sort keeps the selected issue", async ({ page }) => {
	await login(page);
	await page.goto(
		`/issues/?jql=${encodeURIComponent(`project = ${key} ORDER BY key ASC`)}&view=detail`,
	);
	await page.locator(".detail-item", { hasText: `${key}-2` }).click();
	await expect(
		page.getByRole("heading", { name: `Navigator review issue 02 ${run}` }),
	).toBeVisible();

	await page.getByLabel("Order by").selectOption("updated:desc");
	await expect
		.poll(() => jqlFromUrl(page.url()))
		.toContain("ORDER BY updated DESC");
	await expect(
		page.getByRole("heading", { name: `Navigator review issue 02 ${run}` }),
	).toBeVisible();
});

test("a sort that is not in the order list is shown in the order select", async ({
	page,
}) => {
	await login(page);
	await page.goto(
		`/issues/?jql=${encodeURIComponent(`project = ${key} ORDER BY summary ASC`)}&view=detail`,
	);
	await expect(page.getByLabel("Order by")).toHaveValue("summary:asc");
});

test("a modified filter says so and shares the applied query", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await login(page);
	const created = await page.request.post("/api/filters", {
		headers: { "x-requested-with": "rvna" },
		data: {
			name: filterName,
			jql: `project = ${key} ORDER BY key ASC`,
			columns: ["key", "summary"],
		},
	});
	expect(created.status()).toBe(201);
	const filter = (await created.json()) as { id: string };

	const applied = `project = ${key} ORDER BY key DESC`;
	await page.goto(
		`/issues/?filter=${filter.id}&jql=${encodeURIComponent(applied)}&view=list`,
	);
	await expect(
		page.getByRole("heading", { name: `${filterName} (modified)` }),
	).toBeVisible();
	await page.getByRole("button", { name: "Share" }).click();
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	const url = new URL(copied);
	expect(url.searchParams.get("filter")).toBeNull();
	expect(url.searchParams.get("jql")).toBe(applied);
});

test("Save as and Save are disabled while the query has not been applied", async ({
	page,
}) => {
	await login(page);
	const created = await page.request.post("/api/filters", {
		headers: { "x-requested-with": "rvna" },
		data: {
			name: `${filterName} save`,
			jql: `project = ${key} ORDER BY key ASC`,
			columns: ["key", "summary"],
		},
	});
	expect(created.status()).toBe(201);
	const filter = (await created.json()) as { id: string };
	await page.goto(`/issues/?filter=${filter.id}&view=list`);
	await page
		.getByRole("textbox", { name: "Advanced search" })
		.fill(`project = ${key} ORDER BY key DESC`);
	await expect(page.getByRole("button", { name: "Save as" })).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "Save", exact: true }),
	).toBeDisabled();
});

test("a null reporter cell is empty rather than showing the column name", async ({
	page,
}) => {
	await login(page);
	await page.goto(
		`/issues/?jql=${encodeURIComponent(`project = ${key} ORDER BY key ASC`)}&view=list`,
	);
	const reporter = page.locator("th", { hasText: "Reporter" });
	const index = await reporter.evaluate((element) =>
		Array.from(element.parentElement?.children ?? []).indexOf(element),
	);
	await expect(
		page.locator("tbody tr").first().locator("td").nth(index),
	).toHaveText("—");
});

test("an export error is shown instead of downloading the error body", async ({
	page,
}) => {
	await login(page);
	await page.goto(
		`/issues/?jql=${encodeURIComponent(`project = ${key} ORDER BY key ASC`)}&view=list`,
	);
	await page.route("**/api/search/export?*", (route) =>
		route.fulfill({
			status: 400,
			contentType: "application/json",
			body: JSON.stringify({ error: "The export query is invalid" }),
		}),
	);
	await page.getByRole("button", { name: /Export/ }).click();
	await page.getByRole("menuitem", { name: "CSV (current columns)" }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: "The export query is invalid" }),
	).toBeVisible();
});

test("Back restores the search page input from the URL", async ({ page }) => {
	await page.goto("/auth/login?returnTo=/search");
	await page.goto(`/search?q=${encodeURIComponent(key)}`);
	const input = page.getByRole("textbox", { name: "Search all content" });
	await expect(input).toHaveValue(key);

	await input.fill(`${key}-back`);
	await input.press("Enter");
	await expect
		.poll(() => new URL(page.url()).searchParams.get("q"))
		.toBe(`${key}-back`);

	await page.goBack();
	await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(key);
	await expect(input).toHaveValue(key);
});

test("the navigator, filters and search render their title in the server HTML", async ({
	page,
}) => {
	await login(page);
	for (const [path, title] of [
		["/issues/", "Issue Navigator - RVNA"],
		["/secure/ManageFilters.jspa", "Manage filters - RVNA"],
		["/search", "Search - RVNA"],
	] as const) {
		const response = await page.request.get(path, {
			headers: { accept: "text/html" },
		});
		expect(response.status()).toBe(200);
		expect(await response.text()).toContain(`<title>${title}</title>`);
	}
});

test("a failed filter save shows the server error", async ({ page }) => {
	await login(page);
	const created = await page.request.post("/api/filters", {
		headers: { "x-requested-with": "rvna" },
		data: {
			name: `${filterName} failed save`,
			jql: `project = ${key} ORDER BY key ASC`,
			columns: ["key", "summary"],
		},
	});
	expect(created.status()).toBe(201);
	const filter = (await created.json()) as { id: string };
	await page.goto(`/issues/?filter=${filter.id}&view=list`);
	await client.query("delete from filters where id = $1", [filter.id]);

	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Filter not found");
});
