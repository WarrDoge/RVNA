import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
} from "../fixtures/project.ts";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const key = fixtureKey(run);
const dashboardName = `Dashboards e2e ${run}`;
const filterName = `Dashboards filter ${run}`;

let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await createProjectFixture(client, {
		run,
		key,
		name: `Dashboards ${run}`,
		issues: [
			{ summary: `Dashboard issue one ${run}`, status: "todo" },
			{ summary: `Dashboard issue two ${run}`, status: "inProgress" },
			{ summary: `Dashboard issue three ${run}`, status: "done" },
		],
	});
});

test.afterAll(async () => {
	if (client) {
		await client.query("delete from dashboards where name like $1", [
			`%${run}%`,
		]);
		await client.query("delete from filters where name like $1", [`%${run}%`]);
		await dropProjectFixture(client, run);
		await client.end();
	}
});

test("create a dashboard, add a Filter Results gadget, move it and keep the position", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=/secure/ConfigurePortalPages!default.jspa",
	);
	await expect(
		page.getByRole("heading", { name: "Manage dashboards" }),
	).toBeVisible();

	const filterResponse = await page.request.post("/api/filters", {
		data: {
			name: filterName,
			jql: `project = ${key} ORDER BY key ASC`,
			shared: true,
		},
		headers: { "x-requested-with": "rvna" },
	});
	expect(filterResponse.status()).toBe(201);

	await page.getByRole("button", { name: "Create dashboard" }).click();
	const createDialog = page.getByRole("dialog", { name: "Create dashboard" });
	await createDialog.getByLabel("Dashboard name").fill(dashboardName);
	await createDialog.getByRole("button", { name: "Create" }).click();

	await page.getByRole("link", { name: dashboardName }).click();
	await expect(
		page.getByRole("heading", { name: dashboardName }),
	).toBeVisible();
	const dashboards = await page.request.get("/api/dashboards");
	const created = (
		(await dashboards.json()) as { name: string; shared: boolean }[]
	).find((dashboard) => dashboard.name === dashboardName);
	expect(created?.shared).toBe(false);

	await page.getByRole("button", { name: "Add gadget" }).first().click();
	const addDialog = page.getByRole("dialog", { name: "Add gadget" });
	await addDialog
		.locator('[data-gadget-type="filter-results"]')
		.getByRole("button", { name: "Add" })
		.click();

	const gadget = page.locator("[data-gadget-id]").first();
	await expect(gadget).toBeVisible();
	await expect(gadget).toHaveAttribute("data-gadget-column", "0");

	const card = gadget.locator(".card").first();
	const before = await card.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);
	await page.getByRole("button", { name: "Colour of Filter Results" }).click();
	await page.getByRole("button", { name: "Green", exact: true }).click();
	await expect
		.poll(() =>
			card.evaluate((element) => getComputedStyle(element).backgroundColor),
		)
		.not.toBe(before);

	await page.getByRole("button", { name: "Configure Filter Results" }).click();
	const configure = page.getByRole("dialog", {
		name: "Configure Filter Results",
	});
	await configure
		.getByLabel("Saved filter")
		.selectOption({ label: filterName });
	await configure.getByRole("button", { name: "Save" }).click();

	await expect(gadget.getByText(`${key}-1`, { exact: true })).toBeVisible();
	await expect(gadget.getByText(`${key}-2`, { exact: true })).toBeVisible();
	await expect(gadget.getByText(`${key}-3`, { exact: true })).toBeVisible();

	await page
		.locator("[data-gadget-handle]")
		.first()
		.dragTo(page.locator('[data-dashboard-column="1"]'));
	await expect(gadget).toHaveAttribute("data-gadget-column", "1");

	await page.reload();
	const moved = page.locator("[data-gadget-id]").first();
	await expect(moved).toHaveAttribute("data-gadget-column", "1");
	await expect(moved.getByText(`${key}-1`, { exact: true })).toBeVisible();
});

test("the actions menu and the copy dialog return focus to their trigger", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/secure/Dashboard.jspa");
	const response = await page.request.post("/api/dashboards", {
		data: { name: `Focus dashboard ${run}` },
		headers: { "x-requested-with": "rvna" },
	});
	expect(response.status()).toBe(201);
	const created = (await response.json()) as { id: string };
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(`/secure/Dashboard.jspa?selectPageId=${created.id}`)}`,
	);

	const trigger = page
		.getByRole("button", { name: "Dashboard actions" })
		.first();
	await expect(trigger).toBeVisible();
	await trigger.click();
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();

	await trigger.click();
	await page.getByRole("menuitem", { name: "Copy dashboard" }).click();
	await expect(
		page.getByRole("dialog", { name: "Copy dashboard" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();
});
