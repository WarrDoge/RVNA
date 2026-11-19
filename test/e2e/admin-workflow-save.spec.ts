import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const workflowName = `e2e-workflow-save-${run}`;
const statusNames = [`e2e-wf-open-${run}`, `e2e-wf-done-${run}`];

test.afterAll(async () => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await pool.query("delete from workflows where name = $1", [workflowName]);
		await pool.query("delete from statuses where name = any($1)", [
			statusNames,
		]);
	} finally {
		await pool.end();
	}
});

test("a failed draft save keeps the transition dialog open with the error", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/sk-admin");
	await expect(page).toHaveURL(/\/sk-admin$/);

	const origin = new URL(page.url()).origin;
	const headers = { "x-requested-with": "rvna", origin };
	const statusIds: string[] = [];
	for (const [index, name] of statusNames.entries()) {
		const response = await page.request.post("/api/admin/statuses", {
			headers,
			data: { name, category: index === 0 ? "new" : "done" },
		});
		expect(response.status()).toBe(201);
		statusIds.push((await response.json()).id);
	}

	const created = await page.request.post("/api/admin/workflows", {
		headers,
		data: { name: workflowName },
	});
	expect(created.status()).toBe(201);
	const workflowId = (await created.json()).id as string;

	const saved = await page.request.put(
		`/api/admin/workflows/${workflowId}/draft`,
		{
			headers,
			data: {
				initialStatusId: statusIds[0],
				statuses: statusIds,
				transitions: [
					{
						id: randomUUID(),
						name: "Finish",
						fromStatusId: statusIds[0],
						toStatusId: statusIds[1],
						asksResolution: false,
					},
				],
			},
		},
	);
	expect(saved.status()).toBe(200);

	await page.goto(
		`/secure/admin/workflows/ViewWorkflowSteps.jspa?workflowName=${encodeURIComponent(workflowName)}&mode=text`,
	);
	await expect(
		page.getByRole("button", { name: "Add transition" }).first(),
	).toBeVisible();

	let failed = false;
	await page.route(
		`**/api/admin/workflows/${workflowId}/draft`,
		async (route) => {
			if (!failed && route.request().method() === "PUT") {
				failed = true;
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: "Draft save failed for the test" }),
				});
				return;
			}
			await route.continue();
		},
	);

	await page.getByRole("button", { name: "Add transition" }).first().click();
	const dialog = page.getByRole("dialog", { name: "Add transition" });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Transition name").fill("Blocked transition");
	await dialog.getByLabel("To status").selectOption(statusIds[1]);
	await dialog.getByRole("button", { name: "Add", exact: true }).click();

	await expect(dialog).toBeVisible();
	await expect(page.getByText("Draft save failed for the test")).toBeVisible();
	expect(failed).toBe(true);
});
