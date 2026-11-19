import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures.ts";

test("a missing portal answers 404 with the portal card", async ({ page }) => {
	await page.goto("/auth/login?returnTo=/");
	const response = await page.goto(
		`/servicedesk/customer/portal/${randomUUID()}`,
	);
	expect(response?.status()).toBe(404);
	await expect(
		page.getByRole("heading", { name: "Portal not found" }),
	).toBeVisible();
});
