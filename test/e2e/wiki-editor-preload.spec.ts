import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 6).toUpperCase();
const spaceKey = `PRE${run}`;
const createUrl = `/pages/createpage.action?spaceKey=${spaceKey}`;

let client: Client;

async function draftCount() {
	const result = await client.query<{ count: string }>(
		`select count(*) from page_drafts d join spaces s on s.id = d.space_id where s.key = $1`,
		[spaceKey],
	);
	return Number(result.rows[0].count);
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
});

test.afterAll(async () => {
	await client.query("delete from spaces where key = $1", [spaceKey]);
	await client.end();
});

test("hovering a link to the create page address creates no draft; opening it does", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/sk-kit");
	const created = await page.request.post("/api/wiki/spaces", {
		headers: { "X-Requested-With": "rvna" },
		data: { key: spaceKey, name: `Preload space ${run}` },
	});
	expect(created.status()).toBe(201);

	const preloadRequests: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/pages/createpage.action")) {
			preloadRequests.push(request.url());
		}
	});
	await page.evaluate((href) => {
		const link = document.createElement("a");
		link.href = href;
		link.id = "create-link";
		link.setAttribute("data-sveltekit-preload-data", "false");
		link.textContent = "Create";
		link.style.cssText =
			"position: fixed; top: 80px; left: 20px; z-index: 9999;";
		document.body.append(link);
	}, createUrl);

	await page.locator("#create-link").hover();
	await page.waitForTimeout(500);
	expect(preloadRequests).toEqual([]);
	expect(await draftCount()).toBe(0);

	await page.goto(createUrl);
	await expect(page.getByLabel("Page title")).toBeVisible();
	expect(await draftCount()).toBe(1);
});
