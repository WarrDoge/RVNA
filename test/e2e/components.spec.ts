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
const firstSummary = `Component first ${run}`;
const secondSummary = `Component second ${run}`;

let client: Client;
const customFieldSource = `fixture:${run}:field:status`;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await client.query(
		`delete from user_preferences
		 where user_id in (select id from users where username = 'dev')`,
	);
	const fixture = await createProjectFixture(client, {
		run,
		key,
		name: `Components ${run}`,
		issues: [{ summary: firstSummary }, { summary: secondSummary }],
	});
	const field = await client.query<{ id: string }>(
		`insert into fields (source_id, name, type, custom_key)
		 values ($1, 'Status', 'string', $2) returning id`,
		[
			customFieldSource,
			"com.atlassian.jira.plugin.system.customfieldtypes:textfield",
		],
	);
	await client.query(
		`insert into field_contexts (field_id, project_id)
		 values ($1, $2)`,
		[field.rows[0].id, fixture.projectId],
	);
	await client.query("update issues set custom = $1::jsonb where id = $2", [
		JSON.stringify({ [customFieldSource]: "Custom status text" }),
		fixture.issueIds[0],
	]);
});

test.afterAll(async () => {
	if (client) {
		await dropProjectFixture(client, run);
		await client.query("delete from fields where source_id = $1", [
			customFieldSource,
		]);
		await client.query(
			`delete from user_preferences
			 where user_id in (select id from users where username = 'dev')`,
		);
		await client.end();
	}
});

test("the old create issue address opens the navigator with the dialog", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=" +
			encodeURIComponent("/secure/CreateIssue!default.jspa"),
	);
	await expect(page).toHaveURL(/\/issues\//);
	await expect(
		page.getByRole("dialog", { name: "Create Issue" }),
	).toBeVisible();
	await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
	await expect(page.locator(".detail-list, .navigator")).toBeVisible();
});

test("a closed modal is not left in the document", async ({ page }) => {
	await page.goto("/auth/login?returnTo=/secure/Dashboard.jspa");
	await expect(page.locator("dialog.modal")).toHaveCount(0);
	await page.getByRole("button", { name: "Create", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Create Issue" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(page.locator("dialog.modal")).toHaveCount(0);
});

test("Cancel discards an inline summary edit", async ({ page }) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(`/browse/${key}-1`)}`,
	);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		firstSummary,
	);

	await page.getByRole("heading", { level: 1 }).getByRole("button").click();
	const input = page.getByRole("textbox", { name: "Summary" });
	await input.fill(`Cancelled summary ${run}`);
	await page.getByRole("button", { name: "Cancel", exact: true }).click();

	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		firstSummary,
	);
	const response = await page.request.get(`/api/issues/${key}-1`);
	expect(response.status()).toBe(200);
	expect(((await response.json()) as { summary: string }).summary).toBe(
		firstSummary,
	);
});

test("a loading submit button cannot create twice", async ({ page }) => {
	let posts = 0;
	await page.route("**/api/issues", async (route) => {
		if (route.request().method() === "POST") {
			posts += 1;
			await new Promise((resolve) => setTimeout(resolve, 800));
		}
		await route.continue();
	});

	await page.goto("/auth/login?returnTo=/secure/Dashboard.jspa");
	await page.getByRole("button", { name: "Create", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Create Issue" });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Project").selectOption(key);
	await expect(
		dialog.getByLabel("Issue Type", { exact: true }),
	).not.toHaveValue("");
	await dialog.getByLabel("Summary").fill(`Double submit ${run}`);
	await page.evaluate(() => {
		const open = document.querySelector("dialog[open]");
		const button = [...(open?.querySelectorAll("button") ?? [])].find(
			(candidate) => candidate.textContent?.trim() === "Create",
		);
		button?.click();
		setTimeout(() => button?.click(), 100);
	});
	await expect(dialog).toBeHidden({ timeout: 15_000 });
	expect(posts).toBe(1);
});

test("a custom field named like a built-in field still renders", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(`/browse/${key}-1`)}`,
	);
	await expect(
		page.getByRole("heading", { level: 1, name: firstSummary }),
	).toBeVisible();
	await expect(page.getByText("Custom status text")).toBeVisible();
});

test("the epic picker searches the server instead of loading 1000 issues", async ({
	page,
}) => {
	let projectIssueLoads = 0;
	await page.route("**/api/projects/*/issues*", async (route) => {
		projectIssueLoads += 1;
		await route.continue();
	});

	await page.goto("/auth/login?returnTo=/secure/Dashboard.jspa");
	await page.getByRole("button", { name: "Create", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Create Issue" });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Project").selectOption(key);
	const search = page.waitForRequest((request) =>
		request.url().includes("/api/search?"),
	);
	await dialog.getByLabel("Epic Link").fill(`epic ${run}`);
	await search;
	expect(projectIssueLoads).toBe(0);
});

test("selecting another issue resets the inline summary editor", async ({
	page,
}) => {
	const jql = `project = ${key} ORDER BY key ASC`;
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(`/issues/?jql=${jql}&view=detail&selectedIssue=${key}-1`)}`,
	);
	const firstHeading = page.getByRole("heading", {
		level: 1,
		name: firstSummary,
	});
	await expect(firstHeading).toBeVisible();

	await firstHeading.getByRole("button").click();
	await page.getByRole("textbox", { name: "Summary" }).fill("Unsaved draft");

	await page
		.locator(".detail-scroll")
		.getByRole("button", { name: new RegExp(`${key}-2`) })
		.click();
	await expect(
		page.getByRole("heading", { level: 1, name: secondSummary }),
	).toBeVisible();
});
