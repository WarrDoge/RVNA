import { expect, test } from "./fixtures.ts";

test.use({ viewport: { width: 1440, height: 900 } });

test("the workflow diagram is server rendered and reports selections", async ({
	page,
}) => {
	const consoleProblems: string[] = [];
	page.on("console", (message) => {
		if (
			message.type() === "error" ||
			(message.type() === "warning" && /hydrat/i.test(message.text()))
		) {
			consoleProblems.push(message.text());
		}
	});
	page.on("pageerror", (error) => consoleProblems.push(error.message));

	await page.goto("/auth/login?returnTo=/sk-workflow");
	await expect(page).toHaveURL(/\/sk-workflow$/);
	await expect(
		page.getByRole("heading", { name: "Workflow diagram", exact: true }),
	).toBeVisible();

	const response = await page.request.get("/sk-workflow");
	expect(response.status()).toBe(200);
	const html = await response.text();
	for (const text of [
		"Support flow",
		"To Do",
		"In Progress",
		"Done",
		"Release pipeline",
		"Backlog",
		"Blocked",
		"Block from any status",
	]) {
		expect(html).toContain(text);
	}
	expect(html).toContain('aria-label="Workflow diagram"');
	expect(html).toContain('data-status-id="gallery-support-progress"');
	expect(html).toContain('data-transition-id="gallery-support-start"');

	const statusNode = page.locator(
		'[data-gallery="workflow-small"] [data-status-id="gallery-support-progress"]',
	);
	await statusNode.click();
	await expect(page.getByTestId("support-selected-status")).toHaveText(
		"Selected status: gallery-support-progress",
	);
	await expect(statusNode).toHaveAttribute("data-selected", "true");

	const transition = page.locator(
		'[data-gallery="workflow-small"] [data-transition-id="gallery-support-start"] text',
	);
	await transition.click();
	await expect(page.getByTestId("support-selected-transition")).toHaveText(
		"Selected transition: gallery-support-start",
	);
	await expect(page.getByTestId("support-selected-status")).toHaveText(
		"Selected status: none",
	);
	await expect(
		page.locator(
			'[data-gallery="workflow-small"] [data-transition-id="gallery-support-start"]',
		),
	).toHaveAttribute("data-selected", "true");

	expect(consoleProblems).toEqual([]);
});
