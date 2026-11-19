import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const workflowName = `e2e-workflow-refs-${run}`;
const statusName = `e2e-status-refs-${run}`;

test.afterAll(async () => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await pool.query("delete from workflows where name = $1", [workflowName]);
		await pool.query("delete from statuses where name = $1", [statusName]);
	} finally {
		await pool.end();
	}
});

test("a status used by a workflow with no issues cannot be deleted without a migration", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/sk-admin");
	await expect(page).toHaveURL(/\/sk-admin$/);

	const origin = new URL(page.url()).origin;
	const headers = { "x-requested-with": "rvna", origin };
	const statusResponse = await page.request.post("/api/admin/statuses", {
		headers,
		data: { name: statusName, category: "new" },
	});
	expect(statusResponse.status()).toBe(201);
	const status = await statusResponse.json();

	const workflowResponse = await page.request.post("/api/admin/workflows", {
		headers,
		data: { name: workflowName },
	});
	expect(workflowResponse.status()).toBe(201);
	const workflow = await workflowResponse.json();

	const draft = await page.request.put(
		`/api/admin/workflows/${workflow.id}/draft`,
		{
			headers,
			data: {
				initialStatusId: status.id,
				statuses: [status.id],
				transitions: [],
			},
		},
	);
	expect(draft.status()).toBe(200);

	const published = await page.request.post(
		`/api/admin/workflows/${workflow.id}/publish`,
		{ headers, data: { statusMapping: {} } },
	);
	expect(published.status()).toBe(200);
	expect((await published.json()).ok).toBe(true);

	await page.goto("/secure/admin/ViewStatuses.jspa");
	await page.getByRole("button", { name: `Delete ${statusName}` }).click();
	const dialog = page.getByRole("dialog", {
		name: `Delete status: ${statusName}`,
	});
	await expect(dialog).toContainText(workflowName);
	await expect(dialog.getByRole("button", { name: "Delete" })).toBeDisabled();
});
