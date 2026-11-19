import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const fieldName = `e2e-field-save-${run}`;

test.afterAll(async () => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await pool.query("delete from fields where name = $1", [fieldName]);
	} finally {
		await pool.end();
	}
});

test("a failed option toggle or rename keeps the server state visible", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/sk-admin");
	await expect(page).toHaveURL(/\/sk-admin$/);

	const origin = new URL(page.url()).origin;
	const headers = { "x-requested-with": "rvna", origin };
	const created = await page.request.post("/api/admin/custom-fields", {
		headers,
		data: { name: fieldName, type: "select", required: false },
	});
	expect(created.status()).toBe(201);
	const field = await created.json();

	const optionResponse = await page.request.post(
		`/api/admin/custom-fields/${field.id}/options`,
		{ headers, data: { value: "Alpha" } },
	);
	expect(optionResponse.status()).toBe(201);
	const option = await optionResponse.json();

	await page.goto(
		`/secure/admin/ConfigureCustomField!default.jspa?id=${field.id}`,
	);
	const checkbox = page.getByRole("checkbox", { name: "Enable Alpha" });
	await expect(checkbox).toBeChecked();

	await page.route(
		`**/api/admin/custom-fields/${field.id}/options/${option.id}`,
		async (route) => {
			if (route.request().method() !== "PATCH") {
				await route.continue();
				return;
			}
			const body = JSON.parse(route.request().postData() ?? "{}") as {
				disabled?: boolean;
			};
			await route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({
					error:
						body.disabled === undefined
							? "Rename failed for the test"
							: "Toggle failed for the test",
				}),
			});
		},
	);

	await checkbox.click();
	await expect(page.getByText("Toggle failed for the test")).toBeVisible();
	await expect(checkbox).toBeChecked();

	await page.getByTitle("Edit option Alpha").click();
	const editor = page.getByRole("textbox", { name: "option Alpha" });
	await editor.fill("Beta");
	await editor.press("Enter");
	await expect(page.getByText("Rename failed for the test")).toBeVisible();
	await expect(editor).toBeVisible();
	await expect(editor).toHaveValue("Beta");
});
