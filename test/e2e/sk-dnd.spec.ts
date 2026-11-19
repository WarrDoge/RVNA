import { expect, type Locator, type Page, test } from "./fixtures.ts";

function collectConsoleProblems(page: Page) {
	const problems: string[] = [];
	page.on("console", (message) => {
		if (
			message.type() === "error" ||
			(message.type() === "warning" && /hydrat/i.test(message.text()))
		) {
			problems.push(message.text());
		}
	});
	page.on("pageerror", (error) => problems.push(error.message));
	return problems;
}

async function login(page: Page, returnTo: string) {
	await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
	await expect(page).toHaveURL(new RegExp(`${returnTo.replace("/", "\\/")}$`));
}

function cardOrder(zone: Locator) {
	return zone
		.locator('[data-testid^="board-card-"]')
		.evaluateAll((elements) =>
			elements.map((element) => element.getAttribute("data-testid")),
		);
}

function rowOrder(zone: Locator) {
	return zone
		.locator('[data-testid^="backlog-row-"]')
		.evaluateAll((elements) =>
			elements.map((element) => element.getAttribute("data-testid")),
		);
}

test("the gallery is server rendered and drags and reorders with mouse and keyboard", async ({
	page,
	request,
}) => {
	const signedOut = await request.get("/sk-dnd", { maxRedirects: 0 });
	expect(signedOut.status()).toBe(302);
	expect(signedOut.headers().location).toBe("/login.jsp?returnTo=%2Fsk-dnd");

	const consoleProblems = collectConsoleProblems(page);
	await login(page, "/sk-dnd");
	await expect(
		page.getByRole("heading", { name: "Drag and drop gallery" }),
	).toBeVisible();

	const html = await (await page.request.get("/sk-dnd")).text();
	expect(html).toContain('data-testid="board-card-DND-101"');
	expect(html).toContain("Cache the board payload per request");
	expect(html).toContain('data-testid="backlog-row-DND-501"');
	expect(html).toContain("Triage the imported backlog");

	const platform = page.getByTestId("board-lane-platform");
	const todo = platform.getByTestId("board-column-platform-todo");
	const progress = platform.getByTestId("board-column-platform-progress");
	const sprint12 = page.getByTestId("backlog-sprint-section-sprint-12");

	await page
		.getByTestId("board-card-DND-101")
		.dragTo(progress.getByText("In Progress", { exact: true }));
	await expect
		.poll(() => cardOrder(progress))
		.toEqual([
			"board-card-DND-102",
			"board-card-DND-105",
			"board-card-DND-101",
		]);
	await expect.poll(() => cardOrder(todo)).toEqual(["board-card-DND-104"]);

	await page
		.getByTestId("board-card-DND-101")
		.dragTo(page.getByTestId("board-card-DND-102"));
	await expect
		.poll(() => cardOrder(progress))
		.toEqual([
			"board-card-DND-101",
			"board-card-DND-102",
			"board-card-DND-105",
		]);

	await page
		.getByTestId("backlog-row-DND-501")
		.dragTo(sprint12.getByText("Sprint 12", { exact: true }));
	await expect
		.poll(() => rowOrder(sprint12))
		.toEqual([
			"backlog-row-DND-301",
			"backlog-row-DND-302",
			"backlog-row-DND-303",
			"backlog-row-DND-501",
		]);

	await page
		.getByTestId("backlog-row-DND-303")
		.dragTo(page.getByTestId("backlog-row-DND-301"));
	await expect
		.poll(() => rowOrder(sprint12))
		.toEqual([
			"backlog-row-DND-303",
			"backlog-row-DND-301",
			"backlog-row-DND-302",
			"backlog-row-DND-501",
		]);

	const reordered = page.getByTestId("board-card-DND-101");
	await reordered.focus();
	await page.keyboard.press("Space");
	await expect(reordered).toHaveClass(/keyboard-active/);
	await page.keyboard.press("ArrowDown");
	await expect
		.poll(() => cardOrder(progress))
		.toEqual([
			"board-card-DND-102",
			"board-card-DND-101",
			"board-card-DND-105",
		]);
	await page.keyboard.press("Space");
	await expect(reordered).not.toHaveClass(/keyboard-active/);

	const done = platform.getByTestId("board-column-platform-done");
	await reordered.focus();
	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowRight");
	await expect(reordered).toBeFocused();
	await expect
		.poll(() => cardOrder(done))
		.toEqual(["board-card-DND-103", "board-card-DND-101"]);
	await page.keyboard.press("Space");

	const sprint13 = page.getByTestId("backlog-sprint-section-sprint-13");
	const backlogRow = page.getByTestId("backlog-row-DND-301");
	await backlogRow.focus();
	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowRight");
	await expect(backlogRow).toBeFocused();
	await expect
		.poll(() => rowOrder(sprint13))
		.toEqual([
			"backlog-row-DND-401",
			"backlog-row-DND-402",
			"backlog-row-DND-301",
		]);
	await page.keyboard.press("Space");

	expect(consoleProblems).toEqual([]);
});
