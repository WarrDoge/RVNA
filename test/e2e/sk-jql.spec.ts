import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
} from "../fixtures/project.ts";
import { expect, type Page, test } from "./fixtures.ts";

test.use({ viewport: { width: 1440, height: 900 } });

const run = randomUUID().slice(0, 8);
const key = fixtureKey(run);

let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await createProjectFixture(client, {
		run,
		key,
		name: `JQL ${run}`,
		issues: [
			{ summary: `JQL fixture one ${run}`, type: "task", status: "todo" },
			{ summary: `JQL fixture two ${run}`, type: "bug", status: "inProgress" },
			{ summary: `JQL fixture three ${run}`, type: "task", status: "done" },
		],
	});
});

test.afterAll(async () => {
	if (client) {
		await dropProjectFixture(client, run);
		await client.end();
	}
});

function watchConsole(page: Page) {
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
	await expect(page.getByTestId("jql-gallery")).toBeVisible();
}

async function exerciseAdvanced(page: Page) {
	const input = page.getByRole("textbox", { name: "Advanced search" });
	await expect(input).toHaveValue("ORDER BY key DESC");
	await expect(page.getByTestId("current-jql")).toHaveText("ORDER BY key DESC");

	await input.fill("");
	await input.pressSequentially("stat");
	const listbox = page.getByRole("listbox", {
		name: "Advanced search suggestions",
	});
	const options = listbox.getByRole("option");
	await expect(listbox).toBeVisible();
	await expect(options.first()).toHaveAccessibleName(/status/i);
	await expect(options.first()).toHaveAttribute("aria-selected", "false");

	await input.press("ArrowUp");
	await expect(options.last()).toHaveAttribute("aria-selected", "true");
	await input.press("ArrowDown");
	await expect(options.first()).toHaveAttribute("aria-selected", "true");
	await input.press("Enter");
	await expect(input).toHaveValue(/^status /i);
	await expect(page.getByTestId("submit-count")).toHaveText("Submits: 0");

	await input.fill("");
	await input.pressSequentially("stat");
	await expect(options.first()).toBeVisible();
	await input.press("Tab");
	await expect(input).toHaveValue(/^status /i);

	await input.fill("");
	await input.pressSequentially("pri");
	await expect(options.first()).toBeVisible();
	await expect(options.first()).toHaveAccessibleName(/priority/i);
	await options.first().click();
	await expect(input).toHaveValue(/^priority /i);
	await page.waitForTimeout(150);

	await input.fill("project =");
	await input.press("Enter");
	const error = page.getByTestId("jql-error");
	await expect(error).toContainText("Error in the JQL Query");
	await expect(input).toHaveAttribute("aria-invalid", "true");
	await page.keyboard.press("Escape");
	await expect(listbox).toBeHidden();

	await input.fill("project = ABC");
	await input.press("Enter");
	await expect(error).toHaveCount(0);
	await expect(input).toHaveAttribute("aria-invalid", "false");
	await expect(page.getByTestId("submit-count")).toHaveText("Submits: 1");
	await expect(page.getByTestId("current-jql")).toHaveText("project = ABC");
}

async function chooseBasic(page: Page, projectKey: string) {
	await page.getByRole("button", { name: "Basic", exact: true }).click();
	const project = page.getByLabel("Project");
	await expect(project.locator(`option[value="${projectKey}"]`)).toHaveCount(1);
	await project.selectOption(projectKey);

	const type = page.getByLabel("Type");
	await expect(type.locator('option[value="Task"]')).toHaveCount(1);
	await type.selectOption("Task");

	const status = page.getByLabel("Status");
	await expect(status.locator('option[value="To Do"]')).toHaveCount(1);
	await status.selectOption("To Do");

	const expected = `project = ${projectKey} AND issuetype = Task AND status = "To Do" ORDER BY key DESC`;
	const current = page.getByTestId("current-jql");
	await expect(current).toHaveText(expected);
	return (await current.textContent()) ?? "";
}

async function captureBasicStates(page: Page, projectKey: string) {
	const expected = await chooseBasic(page, projectKey);

	for (const label of ["Project", "Type", "Status", "Assignee"]) {
		await page.getByLabel(label).click();
		await page.waitForTimeout(100);
		await page.keyboard.press("Escape");
	}

	await page.getByRole("button", { name: "More" }).click();
	const menu = page.getByRole("menu", { name: "More criteria" });
	await expect(menu).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();

	return expected;
}

test("the Svelte JQL input suggests, validates and submits", async ({
	page,
	request,
}) => {
	const signedOut = await request.get("/sk-jql", { maxRedirects: 0 });
	expect(signedOut.status()).toBe(302);
	expect(signedOut.headers().location).toBe("/login.jsp?returnTo=%2Fsk-jql");

	const problems = watchConsole(page);
	await login(page, "/sk-jql");
	await exerciseAdvanced(page);
	expect(problems).toEqual([]);
});

test("basic mode builds the JQL and keeps the query across modes", async ({
	page,
}) => {
	const problems = watchConsole(page);

	await login(page, "/sk-jql");
	const svelteJql = await captureBasicStates(page, key);
	await page.getByRole("button", { name: "Advanced", exact: true }).click();
	await expect(
		page.getByRole("textbox", { name: "Advanced search" }),
	).toHaveValue(svelteJql);
	await page.getByRole("button", { name: "Basic", exact: true }).click();
	await expect(page.getByLabel("Project")).toHaveValue(key);
	await expect(page.getByLabel("Type")).toHaveValue("Task");
	await expect(page.getByLabel("Status")).toHaveValue("To Do");
	await expect(page.getByTestId("current-jql")).toHaveText(svelteJql);

	expect(problems).toEqual([]);
});
