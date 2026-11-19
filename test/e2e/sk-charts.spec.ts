import { expect, test } from "./fixtures.ts";

test("the chart gallery is server rendered and shows a tooltip on hover", async ({
	page,
	request,
}) => {
	const signedOut = await request.get("/sk-charts", { maxRedirects: 0 });
	expect(signedOut.status()).toBe(302);
	expect(signedOut.headers().location).toBe("/login.jsp?returnTo=%2Fsk-charts");

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

	await page.goto("/auth/login?returnTo=/sk-charts");
	await expect(page).toHaveURL(/\/sk-charts$/);
	const response = await page.request.get("/sk-charts");
	expect(response.status()).toBe(200);
	const html = await response.text();
	expect(html).toMatch(/<svg[^>]*viewBox="0 0 1000 340"/);
	expect(html).toContain('aria-label="Burndown chart"');
	expect(html).toContain('stroke="var(--ds-chart-brand)"');

	await expect(
		page.getByRole("heading", { name: "Charts", exact: true }),
	).toBeVisible();

	const chart = page.locator('[data-testid="chart-burndown"] svg').first();
	const box = await chart.boundingBox();
	if (!box) throw new Error("Burndown chart has no bounding box");
	await page.mouse.move(
		box.x + box.width * 0.4,
		box.y + box.height * (200 / 340),
	);

	const tooltip = page.getByTestId("chart-tooltip");
	await expect(tooltip).toContainText("Remaining: 23");
	await expect(tooltip).toContainText("SAMPLE-21 · estimate changed");

	expect(consoleProblems).toEqual([]);
});
