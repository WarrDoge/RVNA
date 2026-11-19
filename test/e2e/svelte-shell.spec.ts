import { expect, test } from "./fixtures.ts";

test("the Svelte shell is server rendered and hydrates", async ({
	page,
	request,
}) => {
	const signedOut = await request.get("/secure/ViewProfile.jspa", {
		maxRedirects: 0,
	});
	expect(signedOut.status()).toBe(302);
	expect(signedOut.headers().location).toBe(
		"/login.jsp?returnTo=%2Fsecure%2FViewProfile.jspa",
	);

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

	await page.goto("/auth/login?returnTo=/secure/ViewProfile.jspa");
	await expect(page).toHaveURL(/\/secure\/ViewProfile\.jspa$/);
	await expect(page.getByRole("heading", { name: "dev" })).toBeVisible();

	const html = await (
		await page.request.get("/secure/ViewProfile.jspa")
	).text();
	expect(html).toContain('data-color-mode="dark"');
	expect(html).toContain('data-theme="dark:dark');
	expect(html).not.toContain("--ds-background-accent-blue-subtlest");
	expect(html).toContain("Assigned open issues");
	expect(html).toContain('aria-label="RVNA home"');

	const styles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)];
	let themed = false;
	for (const [, href] of styles) {
		const css = await (await page.request.get(href as string)).text();
		if (css.includes("--ds-text:")) themed = true;
	}
	expect(themed).toBe(true);

	// The shell's menus come from hydration, not from a second page load.
	await page.getByRole("button", { name: "Account menu" }).click();
	await expect(page.getByRole("menu", { name: "Account" })).toBeVisible();
	await page.keyboard.press("Escape");
	expect(consoleProblems).toEqual([]);

	await page.getByRole("button", { name: "Account menu" }).click();
	const logout = page.waitForResponse(
		(response) =>
			response.url().endsWith("/auth/logout") &&
			response.request().method() === "POST",
	);
	await page.getByRole("menuitem", { name: "Log out" }).click();
	expect((await logout).status()).toBe(200);
	// Signing out goes to "/" and the development sign-in lands on the dashboard.
	await expect(page).toHaveURL(/\/secure\/Dashboard\.jspa$/);

	// Svelte shell to another Svelte page stays client-side.
	await page.goto("/secure/ViewProfile.jspa");
	await page.getByRole("link", { name: "Dashboards", exact: true }).click();
	await expect(page).toHaveURL(/\/secure\/Dashboard\.jspa$/);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

	await page.getByRole("button", { name: "Account menu" }).click();
	await page.getByRole("menuitem", { name: "Profile" }).click();
	await expect(page).toHaveURL(/\/secure\/ViewProfile\.jspa$/);
	await expect(page.getByRole("heading", { name: "dev" })).toBeVisible();
	expect(consoleProblems).toEqual([]);
});

test("shell links and shortcuts client-navigate between pages", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/secure/ViewProfile.jspa");
	await expect(page).toHaveURL(/\/secure\/ViewProfile\.jspa$/);
	await expect(page.getByRole("heading", { name: "dev" })).toBeVisible();

	const marker = () =>
		page.evaluate(() => (window as { __shellMarker?: string }).__shellMarker);
	const setMarker = () =>
		page.evaluate(() => {
			(window as { __shellMarker?: string }).__shellMarker = "alive";
		});

	// Svelte page to Svelte page: the document is not reloaded.
	await setMarker();
	await page.getByRole("link", { name: "Notifications", exact: true }).click();
	await expect(page).toHaveURL(/selectedTab=notifications/);
	await expect(
		page.getByRole("heading", { name: "Notifications", exact: true }),
	).toBeVisible();
	expect(await marker()).toBe("alive");

	// The shell menu and the `g` shortcut reach the navigator without a document load.
	await setMarker();
	await page.getByRole("button", { name: "Issues", exact: true }).click();
	await page.getByRole("menuitem", { name: "Search for issues" }).click();
	await expect(page).toHaveURL(/\/issues\/$/);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	expect(await marker()).toBe("alive");

	await page.goto("/auth/login?returnTo=/secure/ViewProfile.jspa");
	await expect(page.getByRole("heading", { name: "dev" })).toBeVisible();
	await setMarker();
	await page.keyboard.press("g");
	await page.keyboard.press("i");
	await expect(page).toHaveURL(/\/issues\/$/);
	expect(await marker()).toBe("alive");

	// The Create button and the `c` shortcut open the dialog in place: no navigation.
	await page.goto("/auth/login?returnTo=/secure/ViewProfile.jspa");
	await expect(page.getByRole("heading", { name: "dev" })).toBeVisible();
	await setMarker();
	const dialog = page.getByRole("dialog", { name: "Create Issue" });
	await page
		.getByRole("button", { name: "Create", exact: true })
		.first()
		.click();
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await page.keyboard.press("c");
	await expect(dialog).toBeVisible();
	await expect(page).toHaveURL(/\/secure\/ViewProfile\.jspa$/);
	expect(await marker()).toBe("alive");
});
