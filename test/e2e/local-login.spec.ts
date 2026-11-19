import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";
import { expect, type Page, test } from "./fixtures.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const run = randomUUID().slice(0, 8);
const username = `e2e-${run}`;
const fullName = `E2E User ${run}`;
const firstPassword = `first-passphrase-${run}`;
const secondPassword = `second-passphrase-${run}`;

test.afterAll(async () => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await pool.query("delete from audit_log where summary ilike $1", [
			`%${username}%`,
		]);
		await pool.query("delete from users where username = $1", [username]);
		await pool.query("delete from login_throttle where key = $1", [username]);
	} finally {
		await pool.end();
	}
});

async function logOut(page: Page) {
	await page.getByRole("button", { name: "Account menu" }).click();
	const response = page.waitForResponse(
		(candidate) =>
			candidate.url().endsWith("/auth/logout") &&
			candidate.request().method() === "POST",
	);
	await page.getByRole("menuitem", { name: "Log out" }).click();
	expect((await response).status()).toBe(200);
	// Logout sends the browser to "/"; with dev login configured that lands on the dashboard again.
	await expect(page).toHaveURL(/\/secure\/Dashboard\.jspa/);
}

async function logInLocally(page: Page, password: string) {
	await page.goto("/login.jsp?local=1");
	await expect(
		page.getByRole("heading", { name: "Log in to RVNA" }),
	).toBeVisible();
	await page.getByLabel("Username").fill(username);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Log in" }).click();
}

test("a local account is created, forced to change its password, and logs in again", async ({
	page,
}) => {
	test.setTimeout(90_000);

	await page.goto("/auth/login?returnTo=/");
	await page.goto("/secure/admin/user/UserBrowser.jspa");
	await page.getByRole("button", { name: "Create user" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Username", { exact: true }).fill(username);
	await dialog.getByLabel("Full name", { exact: true }).fill(fullName);
	await dialog
		.getByLabel("Email", { exact: true })
		.fill(`${username}@example.test`);
	await dialog.getByLabel("Password", { exact: true }).fill(firstPassword);
	await dialog.getByLabel("Must change password at next login").check();
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect(dialog).toHaveCount(0);

	await logOut(page);
	await logInLocally(page, firstPassword);

	await expect(
		page.getByRole("heading", { name: "Change your password" }),
	).toBeVisible();
	await expect(
		page.getByText("An administrator requires you to choose a new password"),
	).toBeVisible();
	await page.goto("/secure/BrowseProjects.jspa");
	await expect(
		page.getByRole("heading", { name: "Change your password" }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "RVNA home" })).toHaveCount(0);

	await page.getByLabel("Current password").fill(firstPassword);
	await page.getByLabel("New password", { exact: true }).fill(secondPassword);
	await page.getByLabel("Confirm new password").fill(secondPassword);
	await page.getByRole("button", { name: "Change password" }).click();
	await expect(page.getByRole("link", { name: "RVNA home" })).toBeVisible();

	await logOut(page);
	await logInLocally(page, secondPassword);

	await expect(page).toHaveURL(/\/secure\/Dashboard\.jspa$/);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await page.getByRole("button", { name: "Account menu" }).click();
	await expect(page.getByRole("menu", { name: "Account" })).toContainText(
		fullName,
	);
});
