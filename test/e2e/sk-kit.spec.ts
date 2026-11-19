import { expect, test } from "./fixtures.ts";

test("the SK component gallery renders, focuses and closes its dialogs", async ({
	page,
	request,
}) => {
	const signedOut = await request.get("/sk-kit", { maxRedirects: 0 });
	expect(signedOut.status()).toBe(302);
	expect(signedOut.headers().location).toBe("/login.jsp?returnTo=%2Fsk-kit");

	const consoleProblems: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleProblems.push(message.text());
	});
	page.on("pageerror", (error) => consoleProblems.push(error.message));

	await page.goto("/auth/login?returnTo=/sk-kit");
	await expect(page).toHaveURL(/\/sk-kit$/);
	await expect(
		page.getByRole("heading", { name: "SK component gallery" }),
	).toBeVisible();

	const disabled = page.getByRole("button", { name: "Disabled", exact: true });
	await expect(disabled).toBeDisabled();
	await expect(
		page.getByRole("button", { name: "Primary", exact: true }),
	).toHaveAccessibleName("Primary");
	await expect(
		page.getByRole("button", { name: "Default", exact: true }),
	).toHaveAccessibleName("Default");

	const trigger = page.getByRole("button", { name: "Open modal" });
	await trigger.click();

	const dialog = page.getByRole("dialog", { name: "Create token" });
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute("aria-modal", "true");
	await expect(page.locator("#modal-name")).toBeFocused();

	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();

	await trigger.click();
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();

	await trigger.click();
	await expect(dialog).toBeVisible();
	await page.mouse.click(8, 8);
	await expect(dialog).toBeHidden();

	const menuButton = page.getByRole("button", { name: "Open menu" });
	await menuButton.click();
	await expect(page.getByRole("menu")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menu")).toBeHidden();

	expect(consoleProblems).toEqual([]);
});
