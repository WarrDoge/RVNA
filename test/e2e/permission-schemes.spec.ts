import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
} from "../fixtures/project.ts";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const schemeName = `E2E permission scheme ${run}`;
const removalSchemeName = `E2E removal scheme ${run}`;
const description = `Created from the browser test ${run}`;
const projectRun = `${run}ps`;
const projectKey = fixtureKey(projectRun);
const projectName = `Scheme project ${run}`;

let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await createProjectFixture(client, {
		run: projectRun,
		key: projectKey,
		name: projectName,
		issues: [],
	});
});

test.afterAll(async () => {
	if (client) {
		await client.query(
			"delete from permission_schemes where name = any($1::text[])",
			[[schemeName, removalSchemeName]],
		);
		await dropProjectFixture(client, projectRun);
		await client.end();
	}
});

test("an administrator creates a permission scheme from the schemes page", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=/secure/admin/ViewPermissionSchemes.jspa",
	);
	await expect(
		page.getByRole("heading", { name: "Permission schemes" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Create permission scheme" }).click();
	const dialog = page.getByRole("dialog", {
		name: "Create permission scheme",
	});
	await dialog.getByLabel("Name").fill(schemeName);
	await dialog.getByLabel("Description (optional)").fill(description);
	await dialog.getByRole("button", { name: "Create", exact: true }).click();

	await expect(page).toHaveURL(/ViewPermissionScheme\.jspa\?id=/);
	await expect(page.getByRole("heading", { name: schemeName })).toBeVisible();
	await expect(page.getByText(description)).toBeVisible();
	await expect(
		page.getByRole("cell", { name: "Browse projects" }),
	).toBeVisible();
	await expect(page.getByText("Anyone", { exact: true })).toBeVisible();
});

test("an administrator removes a project and deletes the scheme", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=/secure/admin/ViewPermissionSchemes.jspa",
	);
	await page.getByRole("button", { name: "Create permission scheme" }).click();
	const createDialog = page.getByRole("dialog", {
		name: "Create permission scheme",
	});
	await createDialog.getByLabel("Name").fill(removalSchemeName);
	await createDialog
		.getByRole("button", { name: "Create", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: removalSchemeName }),
	).toBeVisible();

	await page.getByRole("button", { name: "Assign project" }).click();
	const assignDialog = page.getByRole("dialog", {
		name: "Assign permission scheme to a project",
	});
	await assignDialog
		.getByLabel("Project")
		.selectOption({ label: `${projectKey} — ${projectName}` });
	await assignDialog.getByRole("button", { name: "Assign" }).click();
	await page
		.getByRole("dialog", { name: "Assign permission scheme" })
		.getByRole("button", { name: "Assign", exact: true })
		.last()
		.click();
	await expect(
		page.locator(".projects").getByRole("link", { name: projectName }),
	).toBeVisible();

	const deleteButton = page.getByRole("button", { name: "Delete scheme" });
	await expect(deleteButton).toBeDisabled();
	await expect(
		page.getByText("Remove every project before deleting this scheme."),
	).toBeVisible();

	await page
		.locator(".projects li")
		.filter({ hasText: projectKey })
		.getByRole("button", { name: "Remove" })
		.click();
	await page
		.getByRole("dialog", { name: "Remove project from permission scheme" })
		.getByRole("button", { name: "Remove" })
		.click();
	await expect(page.getByText("No project uses this scheme.")).toBeVisible();
	await expect(deleteButton).toBeEnabled();

	await deleteButton.click();
	await page
		.getByRole("dialog", { name: "Delete permission scheme" })
		.getByRole("button", { name: "Delete" })
		.click();
	await expect(page).toHaveURL(/ViewPermissionSchemes\.jspa/);
	await expect(
		page.getByRole("heading", { name: "Permission schemes" }),
	).toBeVisible();
	await expect(page.getByText(removalSchemeName)).toHaveCount(0);
});
