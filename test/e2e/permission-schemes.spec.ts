import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const schemeName = `E2E permission scheme ${run}`;
const description = `Created from the browser test ${run}`;

let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
});

test.afterAll(async () => {
	if (client) {
		await client.query("delete from permission_schemes where name = $1", [
			schemeName,
		]);
		await client.end();
	}
});

test("an administrator creates a permission scheme from the schemes page", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=/secure/admin/ViewPermissionSchemes.jspa",
	);
	await expect(
		page.getByRole("heading", { name: "Permission schemes" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Create permission scheme" }).click();
	const dialog = page.getByRole("dialog", {
		name: "Create permission scheme",
	});
	await dialog.getByLabel("Name").fill(schemeName);
	await dialog.getByLabel("Description (optional)").fill(description);
	await dialog.getByRole("button", { name: "Create", exact: true }).click();

	await expect(page).toHaveURL(/ViewPermissionScheme\.jspa\?id=/);
	await expect(page.getByRole("heading", { name: schemeName })).toBeVisible();
	await expect(page.getByText(description)).toBeVisible();
	await expect(
		page.getByRole("cell", { name: "Browse projects" }),
	).toBeVisible();
	await expect(page.getByText("Anyone", { exact: true })).toBeVisible();
});
