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
const summaries = [
	`Offset one ${run}`,
	`Offset two ${run}`,
	`Offset three ${run}`,
];

let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await createProjectFixture(client, {
		run,
		key,
		issues: summaries.map((summary) => ({ summary })),
	});
});

test.afterAll(async () => {
	if (!client) return;
	await dropProjectFixture(client, run);
	await client.end();
});

test("an offset past the last page is clamped to the last page", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(`/projects/${key}/issues?offset=1000`)}`,
	);
	await expect(page.getByText("1–3 of 3")).toBeVisible();
	await expect(page.locator("tbody tr")).toHaveCount(3);
	for (const summary of summaries) {
		await expect(page.getByText(summary)).toBeVisible();
	}
});

test("the summary column keeps its width and never widens the page", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(`/projects/${key}/issues`)}`,
	);
	for (const width of [1024, 1280, 1440, 1920]) {
		await page.setViewportSize({ width, height: 900 });
		const summary = page.locator("td.fat-col-fill").first();
		await expect(summary).toBeVisible();
		expect((await summary.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(
			300,
		);
		const sizes = await page.evaluate(() => ({
			document: document.documentElement.scrollWidth,
			viewport: window.innerWidth,
		}));
		expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
	}
	await page.locator("td.fat-col-fill a").first().click();
	await expect(page).toHaveURL(new RegExp(`/browse/${key}-\\d+`));
});
