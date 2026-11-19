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
const filterName = `Navigator errors e2e ${run}`;

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
		name: `Navigator errors ${run}`,
		issues: [{ summary: `Navigator error issue ${run}` }],
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

test("an invalid JQL stays inline and the fixed query runs without a reload", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/issues/");

	const response = await page.goto(
		`/issues/?jql=${encodeURIComponent("nosuchfield = 1")}&view=list`,
	);
	expect(response?.status()).toBe(200);

	await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
	const jql = page.getByRole("textbox", { name: "Advanced search" });
	await expect(jql).toHaveValue("nosuchfield = 1");
	const alert = page.getByRole("alert");
	await expect(alert).toContainText("Field 'nosuchfield' does not exist");
	await expect(page.getByText("0 issues")).toBeVisible();
	await expect(page.getByText("No issues match this query.")).toBeVisible();
	await expect(page.locator(".navigator")).toHaveAttribute(
		"data-hydrated",
		"true",
	);

	let loads = 0;
	page.on("load", () => {
		loads += 1;
	});

	const fixed = `project = ${key} ORDER BY key ASC`;
	await jql.fill(fixed);
	await jql.press("Enter");

	await expect.poll(() => jqlFromUrl(page.url())).toBe(fixed);
	await expect(page.getByText("1 issue", { exact: true })).toBeVisible();
	await expect(page.locator("tbody tr")).toHaveCount(1);
	await expect(alert).toHaveCount(0);
	await expect(jql).toHaveValue(fixed);
	await expect(jql).toBeFocused();
	expect(loads).toBe(0);
});

test("a saved filter with an invalid JQL shows the error under the JQL box", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/issues/");

	const created = await page.request.post("/api/filters", {
		headers: { "x-requested-with": "rvna" },
		data: {
			name: filterName,
			jql: `project = ${key}`,
			columns: ["key", "summary"],
		},
	});
	expect(created.status()).toBe(201);
	const filter = (await created.json()) as { id: string };
	await client.query("update filters set jql = $1 where id = $2", [
		"nosuchfield = 1",
		filter.id,
	]);

	const response = await page.goto(`/issues/?filter=${filter.id}`);
	expect(response?.status()).toBe(200);

	await expect(page.getByRole("heading", { name: filterName })).toBeVisible();
	await expect(
		page.getByRole("textbox", { name: "Advanced search" }),
	).toHaveValue("nosuchfield = 1");
	await expect(page.getByRole("alert")).toContainText(
		"Field 'nosuchfield' does not exist",
	);
});

test("a filter the user cannot see falls back to the default search", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/issues/");

	const response = await page.goto(`/issues/?filter=${randomUUID()}`);
	expect(response?.status()).toBe(200);

	await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
	await expect(
		page.getByRole("textbox", { name: "Advanced search" }),
	).toHaveValue("ORDER BY key DESC");
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a selected issue that does not exist leaves the list and shows an error in the pane", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/issues/");

	const response = await page.goto(
		`/issues/?jql=${encodeURIComponent(`project = ${key}`)}&view=detail&selectedIssue=${key}-999`,
	);
	expect(response?.status()).toBe(200);

	await expect(
		page.getByRole("heading", {
			name: "You do not have permission to view this issue",
		}),
	).toBeVisible();
	await expect(page.getByText(`Navigator error issue ${run}`)).toBeVisible();
});
