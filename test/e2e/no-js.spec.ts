import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { hashPassword } from "../../src/lib/server/passwords.ts";

const run = randomUUID().slice(0, 8);
const username = `e2e-nojs-${run}`;
const password = `no-js-passphrase-${run}`;
let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await client.query(
		`insert into users (username, display_name, password_hash)
		 values ($1, $2, $3)`,
		[username, `No JS ${run}`, await hashPassword(password)],
	);
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from users where username = $1", [username]);
	await client.query("delete from login_throttle where key like $1", [
		`${username.toLowerCase()}|%`,
	]);
	await client.end();
});

test("forms show action results and a token is created without JavaScript", async ({
	browser,
}) => {
	const context = await browser.newContext({
		baseURL: test.info().project.use.baseURL,
		javaScriptEnabled: false,
	});
	const page = await context.newPage();

	await page.goto("/login.jsp?local=1");
	await page.getByLabel("Username").fill(username);
	await page.getByLabel("Password").fill("not the password");
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page.getByRole("alert")).toContainText(
		"Incorrect username or password",
	);

	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).toHaveURL(/\/secure\/Dashboard\.jspa$/);

	await page.goto("/secure/ViewProfile.jspa?selectedTab=tokens");
	await page.getByRole("button", { name: "Create token" }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.getByLabel("Name").fill(`No JS token ${run}`);
	await page.getByLabel("Expires in days").fill("7");
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Create", exact: true })
		.click();
	await expect(page.getByText(/^rvna_[A-Za-z0-9_-]+$/)).toBeVisible();

	await context.close();
});
