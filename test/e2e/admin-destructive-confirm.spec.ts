import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const groupName = `e2e-admin-confirm-${run}`;

test.afterAll(async () => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await pool.query(
			"delete from permission_grants where holder_parameter = $1",
			[groupName],
		);
		await pool.query("delete from groups where name = $1", [groupName]);
	} finally {
		await pool.end();
	}
});

test("removing a global permission asks for confirmation first", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/sk-admin");
	await expect(page).toHaveURL(/\/sk-admin$/);

	const origin = new URL(page.url()).origin;
	const headers = { "x-requested-with": "rvna", origin };
	const group = await page.request.post("/api/admin/groups", {
		headers,
		data: { name: groupName },
	});
	expect(group.status()).toBe(201);

	const granted = await page.request.post("/api/admin/global-permissions", {
		headers,
		data: { holderType: "group", holderParameter: groupName },
	});
	expect(granted.status()).toBe(201);

	await page.goto("/secure/admin/ViewGlobalPermissions.jspa");
	const row = page.getByRole("row", { name: new RegExp(groupName) });
	await expect(row).toBeVisible();

	await row.getByRole("button", { name: "Remove" }).click();
	const dialog = page.getByRole("dialog", { name: "Remove global permission" });
	await expect(dialog).toBeVisible();
	await expect(row).toBeVisible();

	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toBeHidden();
	await expect(row).toBeVisible();

	await row.getByRole("button", { name: "Remove" }).click();
	await page
		.getByRole("dialog", { name: "Remove global permission" })
		.getByRole("button", { name: "Remove" })
		.click();
	await expect(row).toHaveCount(0);
});
