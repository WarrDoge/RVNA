import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);

test("Copy still copies the token when the Clipboard API is unavailable", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=/secure/ViewProfile.jspa?selectedTab=tokens",
	);
	await expect(
		page.getByRole("heading", { name: "Personal access tokens" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Create token" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill(`Copy token ${run}`);
	await dialog.getByRole("button", { name: "Create", exact: true }).click();
	await expect(dialog.getByText(/^rvna_[A-Za-z0-9_-]+$/)).toBeVisible();

	await page.evaluate(() => {
		Object.defineProperty(navigator, "clipboard", {
			value: undefined,
			configurable: true,
		});
	});
	await dialog.getByRole("button", { name: "Copy" }).click();
	await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
});
