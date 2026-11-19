import { expect, test } from "./fixtures.ts";

test("shell, personal access tokens and logout", async ({ page }) => {
	await page.goto("/");

	await expect(page).toHaveURL(/\/secure\/Dashboard\.jspa$/);
	await expect(page.getByRole("link", { name: "RVNA home" })).toBeVisible();
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page.getByRole("button", { name: "Create" })).toBeEnabled();
	await expect(
		page.getByRole("button", { name: "Account menu" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Account menu" }).click();
	await page.getByRole("menuitem", { name: "Personal access tokens" }).click();

	await expect(page).toHaveURL(
		/\/secure\/ViewProfile\.jspa\?selectedTab=tokens$/,
	);
	await expect(
		page.getByRole("heading", { name: "Personal access tokens" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Create token" }).click();
	const createDialog = page.getByRole("dialog");
	await createDialog.getByLabel("Name").fill("e2e token");
	await createDialog.getByLabel("Expires in days").fill("7");
	await createDialog.getByRole("button", { name: "Create" }).click();

	await expect(page.getByText(/^rvna_[A-Za-z0-9_-]+$/)).toBeVisible();
	await page.getByRole("button", { name: "Done" }).click();
	await expect(page.getByRole("cell", { name: "e2e token" })).toBeVisible();

	const row = page.getByRole("row", { name: /e2e token/ });
	await row.getByRole("button", { name: "Revoke" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Revoke" })
		.click();
	await expect(page.getByRole("cell", { name: "e2e token" })).toHaveCount(0);

	await page.getByRole("button", { name: "Account menu" }).click();
	const logout = page.waitForResponse(
		(response) =>
			response.url().endsWith("/auth/logout") &&
			response.request().method() === "POST",
	);
	await page.getByRole("menuitem", { name: "Log out" }).click();

	const response = await logout;
	expect(response.status()).toBe(200);
	await expect(page).toHaveURL(/\/secure\/Dashboard\.jspa$/);
});

test("the old logout address asks before it ends the session", async ({
	page,
}) => {
	await page.goto("/secure/Logout!default.jspa");
	await expect(page.getByRole("heading", { name: "Log out" })).toBeVisible();

	const logout = page.waitForResponse(
		(response) =>
			response.url().endsWith("/auth/logout") &&
			response.request().method() === "POST",
	);
	await page.getByRole("button", { name: "Log out", exact: true }).click();
	expect((await logout).status()).toBe(200);
	await expect(page).toHaveURL(/\/secure\/Dashboard\.jspa$/);
});
