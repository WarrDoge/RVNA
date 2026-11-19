import { expect, test } from "./fixtures.ts";

test("the filter search follows the URL and a tab click wins over typing", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=/secure/ManageFilters.jspa%3Ftab%3Dsearch%26query%3Dalpha",
	);
	await expect(page.getByLabel("Search filters")).toHaveValue("alpha");

	await page.getByLabel("Search filters").fill("beta");
	await page.getByLabel("Search filters").press("Enter");
	await expect(page).toHaveURL(/query=beta/);
	await expect(page.getByLabel("Search filters")).toHaveValue("beta");

	await page.goBack();
	await expect(page).toHaveURL(/query=alpha/);
	await expect(page.getByLabel("Search filters")).toHaveValue("alpha");

	await page.getByLabel("Search filters").fill("gamma");
	await page.getByRole("button", { name: "My", exact: true }).click();
	await expect(page).toHaveURL(/tab=mine/);
	await page.waitForTimeout(500);
	await expect(page).toHaveURL(/tab=mine/);
});
