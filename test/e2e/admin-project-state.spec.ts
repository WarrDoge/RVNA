import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const tag = run.toUpperCase();
const projectA = `SA${tag.slice(0, 4)}`;
const projectB = `SB${tag.slice(0, 4)}`;

let client: Client;
const projectIds: string[] = [];

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	for (const key of [projectA, projectB]) {
		const result = await client.query<{ id: string }>(
			`insert into projects (source_id, key, name, project_type, last_issue_number)
			 values ($1, $2, $3, 'software', 0) returning id`,
			[`e2e-project-state:${key}:${run}`, key, `E2E state ${key}`],
		);
		const id = result.rows[0]?.id;
		if (id) projectIds.push(id);
	}
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from projects where id = any($1::uuid[])", [
		projectIds,
	]);
	await client.end();
});

test("a project change recreates the open role dialog", async ({ page }) => {
	await page.goto(
		`/auth/login?returnTo=/plugins/servlet/project-config/${projectA}/roles`,
	);
	await expect(
		page.getByRole("heading", { name: "Users and roles" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Add users to a role" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Role").selectOption("viewer");
	await expect(dialog.getByLabel("Role")).toHaveValue("viewer");

	await page.evaluate((href) => {
		const link = document.createElement("a");
		link.href = href;
		link.textContent = "Go";
		document.body.appendChild(link);
		link.click();
	}, `/plugins/servlet/project-config/${projectB}/roles`);

	await expect(page).toHaveURL(
		new RegExp(`/project-config/${projectB}/roles$`),
	);
	await expect(dialog).toHaveCount(0);
});

test("the settings pages render their title on the server", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(`/plugins/servlet/project-config/${projectA}/summary`)}`,
	);
	await expect(
		page.getByRole("heading", { name: "Project settings" }),
	).toBeVisible();
	await expect(page).toHaveTitle(/^Project settings - /);

	await page.goto(`/plugins/servlet/project-config/${projectA}/roles`);
	await expect(
		page.getByRole("heading", { name: "Users and roles" }),
	).toBeVisible();
	await expect(page).toHaveTitle(/^Users and roles - /);
});
