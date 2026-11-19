import { expect, test } from "./fixtures.ts";

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("the JQL input announces its listbox and inserts at the caret after a move", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/sk-jql");
	const input = page.getByRole("textbox", { name: "Advanced search" });
	const listbox = page.getByRole("listbox", {
		name: "Advanced search suggestions",
	});

	await input.fill("");
	await input.pressSequentially("stat");
	await expect(listbox).toBeVisible();
	await expect(input).toHaveAttribute("aria-expanded", "true");
	await expect(input).toHaveAttribute("aria-haspopup", "listbox");
	const controls = await input.getAttribute("aria-controls");
	expect(controls).not.toBeNull();
	await expect(listbox).toHaveAttribute("id", controls ?? "");

	await input.press("ArrowDown");
	const first = listbox.getByRole("option").first();
	await expect(first).toHaveAttribute("aria-selected", "true");
	const optionId = await first.getAttribute("id");
	await expect(input).toHaveAttribute("aria-activedescendant", optionId ?? "");

	await input.press("Home");
	const label = (
		(await listbox
			.getByRole("option")
			.first()
			.locator("span")
			.first()
			.textContent()) ?? ""
	).trim();
	expect(label).not.toBe("");
	await input.press("Enter");
	await expect(input).toHaveValue(new RegExp(`^${escapeRegExp(label)} `, "i"));
});

test("the focused JQL input has a visible focus outline", async ({ page }) => {
	await page.goto("/auth/login?returnTo=/sk-jql");
	const input = page.getByRole("textbox", { name: "Advanced search" });
	await input.focus();
	await expect(input).toHaveCSS("outline-style", "solid");
});
