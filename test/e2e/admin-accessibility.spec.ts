import { expect, test } from "./fixtures.ts";

test("an admin form field describes its hint and error to assistive technology", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=/secure/admin/ViewApplicationProperties.jspa",
	);
	const title = page.getByLabel("Site title");
	await expect(title).toHaveAttribute("aria-required", "true");
	const describedBy = await title.getAttribute("aria-describedby");
	expect(describedBy).toBeTruthy();
	await expect(page.locator(`#${describedBy}`)).toContainText(
		"Shown in the browser tab",
	);

	await title.fill("");
	await expect(title).toHaveAttribute("aria-invalid", "true");
	const invalidBy = await title.getAttribute("aria-describedby");
	expect(invalidBy).toBeTruthy();
	const errorId = invalidBy?.split(/\s+/).find((id) => id.endsWith("-error"));
	expect(errorId).toBeTruthy();
	await expect(page.locator(`#${errorId}`)).toContainText(
		"The site title cannot be empty",
	);
});

test("the admin navigation marks the section a detail page belongs to", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=/secure/admin/ConfigureCustomField!default.jspa",
	);
	await expect(
		page
			.getByRole("navigation", { name: "Administration" })
			.getByRole("link", { name: "Custom fields" }),
	).toHaveAttribute("aria-current", "page");
});
