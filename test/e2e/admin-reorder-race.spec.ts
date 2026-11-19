import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const names = [
	`e2e-order-a-${run}`,
	`e2e-order-b-${run}`,
	`e2e-order-c-${run}`,
];

test.afterAll(async () => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await pool.query("delete from priorities where name = any($1)", [names]);
	} finally {
		await pool.end();
	}
});

test("overlapping priority reorders are sent in order and the last one wins", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/sk-admin");
	await expect(page).toHaveURL(/\/sk-admin$/);

	const origin = new URL(page.url()).origin;
	const headers = { "x-requested-with": "rvna", origin };
	for (const name of names) {
		const response = await page.request.post("/api/admin/priorities", {
			headers,
			data: { name },
		});
		expect(response.status()).toBe(201);
	}

	await page.goto("/secure/admin/ViewPriorities.jspa");
	const rows = page.locator("tbody tr");
	await expect(rows.nth(0)).toContainText(names[0] as string);
	await expect(rows.nth(1)).toContainText(names[1] as string);
	await expect(rows.nth(2)).toContainText(names[2] as string);

	let requests = 0;
	await page.route("**/api/admin/priorities/order", async (route) => {
		requests += 1;
		if (requests === 1) {
			await new Promise((resolve) => setTimeout(resolve, 800));
		}
		await route.continue();
	});

	await page
		.getByRole("button", { name: `Move priority ${names[0]} down` })
		.click();
	await page
		.getByRole("button", { name: `Move priority ${names[0]} down` })
		.click();

	await expect(rows.nth(0)).toContainText(names[1] as string);
	await expect(rows.nth(1)).toContainText(names[2] as string);
	await expect(rows.nth(2)).toContainText(names[0] as string);
	await expect.poll(() => requests).toBe(2);
	await page.waitForLoadState("networkidle");

	await page.reload();
	await expect(rows.nth(0)).toContainText(names[1] as string);
	await expect(rows.nth(1)).toContainText(names[2] as string);
	await expect(rows.nth(2)).toContainText(names[0] as string);
});
