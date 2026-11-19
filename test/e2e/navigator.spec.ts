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
const filterName = `Navigator e2e ${run}`;

let client: Client;
let savedFilterId: string;

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
		name: `Navigator ${run}`,
		issues: Array.from({ length: 12 }, (_, index) => ({
			summary: `Navigator issue ${String(index + 1).padStart(2, "0")}`,
			status:
				index % 3 === 0 ? "done" : index % 3 === 1 ? "todo" : "inProgress",
			type: index % 2 === 0 ? "task" : "bug",
			priority: index % 2 === 0 ? "high" : "low",
			labels: index === 0 ? ["alpha", "beta"] : [],
			storyPoints: index + 1,
		})),
	});
	const owner = await client.query<{ id: string }>(
		`select id from users where username = 'dev'`,
	);
	const filter = await client.query<{ id: string }>(
		`insert into filters (name, jql, owner_id, columns, shared, source_id)
		 values ($1, $2, $3, '[]'::jsonb, false, $4) returning id`,
		[
			`Navigator e2e saved ${run}`,
			`project = ${key} ORDER BY key ASC`,
			owner.rows[0]?.id,
			`navigator-e2e-${run}`,
		],
	);
	savedFilterId = filter.rows[0]?.id as string;
});

test.afterAll(async () => {
	if (client) {
		await client.query("delete from filters where name like $1", [
			`Navigator e2e ${run}%`,
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

test("search, sort, add a column, save, favourite, open and step through issues", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/issues/");
	await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();

	const jql = `project = ${key} ORDER BY key ASC`;
	await page.goto(`/issues/?jql=${encodeURIComponent(jql)}&view=list`);
	await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
	await expect(page.locator("tbody tr")).toHaveCount(12);
	await expect(page.getByText(`${key}-1`, { exact: true })).toBeVisible();
	await expect(page.getByText("12 issues")).toBeVisible();

	await page.getByRole("button", { name: "Summary", exact: true }).click();
	await expect
		.poll(() => jqlFromUrl(page.url()))
		.toBe(`project = ${key} ORDER BY summary ASC`);
	await expect(page.locator("tbody tr").first()).toContainText(
		"Navigator issue 01",
	);

	await page.getByRole("button", { name: /Columns/ }).click();
	const columns = page.getByRole("dialog", { name: "Columns" });
	await columns.getByLabel("Labels").check();
	await page.keyboard.press("Escape");
	await expect(
		page.locator("thead").getByRole("button", { name: /Labels/ }),
	).toBeVisible();
	await expect(page.locator("tbody tr").first()).toContainText("alpha, beta");

	await page.getByRole("button", { name: "Save as" }).click();
	await page.getByLabel("Name").fill(filterName);
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Save", exact: true })
		.click();
	await expect(page.getByRole("heading", { name: filterName })).toBeVisible();
	await expect(page).toHaveURL(/filter=[0-9a-f-]+/);

	await page.goto("/secure/ManageFilters.jspa");
	await page.getByRole("button", { name: "My", exact: true }).click();
	const row = page.locator("tbody tr", { hasText: filterName });
	await expect(row).toBeVisible();
	await row
		.getByRole("button", { name: `Add ${filterName} to favourites` })
		.click();
	await expect(
		row.getByRole("button", { name: `Remove ${filterName} from favourites` }),
	).toBeVisible();

	await page.goto("/issues/");
	await page.getByRole("button", { name: "Issues", exact: true }).click();
	await page.getByRole("link", { name: filterName }).click();
	await expect(page.getByRole("heading", { name: filterName })).toBeVisible();
	await expect(page.locator("tbody tr")).toHaveCount(12);

	await page.getByRole("button", { name: "Detail view" }).click();
	await expect(page.getByText("1 of 12")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Navigator issue 01" }),
	).toBeVisible();

	await page.keyboard.press("j");
	await expect(page.getByText("2 of 12")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Navigator issue 02" }),
	).toBeVisible();

	await page.getByLabel("Search", { exact: true }).fill(`${key}-3`);
	await expect(
		page.locator("#quicksearch-results").getByText(`${key}-3`),
	).toBeVisible();
	await page.getByLabel("Search", { exact: true }).press("Enter");
	await expect(page).toHaveURL(new RegExp(`/browse/${key}-3$`));
	await expect(
		page.getByRole("heading", { name: "Navigator issue 03" }),
	).toBeVisible();
});

test("a comment draft does not follow to another issue in the detail pane", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/issues/");
	const jql = `project = ${key} ORDER BY key ASC`;
	await page.goto(
		`/issues/?jql=${encodeURIComponent(jql)}&view=detail&selectedIssue=${key}-1`,
	);
	await expect(
		page.getByRole("heading", { name: "Navigator issue 01" }),
	).toBeVisible();

	const editor = page.locator(".ProseMirror").last();
	await editor.click();
	await page.keyboard.type("draft for issue one");
	await expect(editor).toContainText("draft for issue one");

	await page.locator(".detail-item", { hasText: `${key}-2` }).click();
	await expect(
		page.getByRole("heading", { name: "Navigator issue 02" }),
	).toBeVisible();
	await expect(page.locator(".ProseMirror").last()).toHaveText("");
});

test("an invalid query shows the server error without a retry delay", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/issues/");
	await page.goto(
		`/issues/?jql=${encodeURIComponent("nosuchfield = 1")}&view=list`,
	);
	await expect(
		page.getByText(/Field 'nosuchfield' does not exist/),
	).toBeVisible({ timeout: 3000 });
});

test("ArrowDown then Enter picks the first JQL suggestion", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/issues/");
	await page.goto(
		`/issues/?jql=${encodeURIComponent("order by key")}&view=list`,
	);
	const jql = page.getByRole("textbox", { name: "Advanced search" });
	await jql.fill("");
	await jql.pressSequentially("stat");
	const options = page.getByRole("listbox", {
		name: "Advanced search suggestions",
	});
	const first = (
		(await options
			.getByRole("option")
			.first()
			.locator("span")
			.first()
			.textContent()) ?? ""
	).trim();
	expect(await options.getByRole("option").count()).toBeGreaterThan(1);
	await jql.press("ArrowDown");
	await jql.press("Enter");
	await expect(jql).toHaveValue(new RegExp(`^${first} `, "i"));
});

test("the summary column keeps 20rem and never widens the page", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/issues/");

	for (const path of [
		`/issues/?jql=${encodeURIComponent(`project = ${key} ORDER BY key ASC`)}&view=list`,
		`/issues/?filter=${savedFilterId}&view=list`,
	]) {
		await page.goto(path);
		await expect(page.locator("tbody tr")).toHaveCount(12);

		for (const width of [1024, 1280, 1440, 1920]) {
			await page.setViewportSize({ width, height: 900 });
			for (const open of [true, false]) {
				const show = page.getByRole("button", { name: "Show filters" });
				const hide = page.getByRole("button", { name: "Hide filters" });
				if (open && (await show.count())) await show.click();
				if (!open && (await hide.count())) await hide.click();

				const summary = page.locator("td.fat-col-fill").first();
				await expect(summary).toBeVisible();
				const box = await summary.boundingBox();
				expect(box?.width ?? 0).toBeGreaterThanOrEqual(300);

				const sizes = await page.evaluate(() => ({
					document: document.documentElement.scrollWidth,
					body: document.body.scrollWidth,
					viewport: window.innerWidth,
				}));
				expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
				expect(sizes.body).toBeLessThanOrEqual(sizes.viewport);

				if (width === 1280 && open) {
					const scroll = await page.evaluate(() => {
						const element =
							document.querySelector<HTMLElement>(".table-scroll");
						return element
							? {
									scroll: element.scrollWidth,
									client: element.clientWidth,
								}
							: null;
					});
					expect(scroll?.scroll ?? 0).toBeGreaterThan(scroll?.client ?? 0);
				}
			}
		}
	}

	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(
		`/issues/?jql=${encodeURIComponent(`project = ${key} ORDER BY key ASC`)}&view=list`,
	);
	const summaryLink = page.locator("td.fat-col-fill a").first();
	await expect(summaryLink).toHaveAttribute(
		"title",
		(await summaryLink.textContent()) ?? "",
	);
});
