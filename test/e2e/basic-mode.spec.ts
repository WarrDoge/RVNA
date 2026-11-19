import { expect, test } from "./fixtures.ts";

test("adding a list criterion shows its picker", async ({ page }) => {
	await page.goto("/auth/login?returnTo=/sk-jql");
	await page.getByRole("button", { name: "Basic", exact: true }).click();
	await page.getByRole("button", { name: "More" }).click();
	await page
		.getByRole("menu", { name: "More criteria" })
		.getByRole("menuitem", { name: "Priority" })
		.click();
	await expect(page.getByLabel("Priority", { exact: true })).toBeVisible();
});
