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
const manageName = `Manage state ${run}`;
const raceName = `Gadget race ${run}`;
const filterName = `Gadget race filter ${run}`;
const columnsName = `Gadget columns ${run}`;
const columnsFilterName = `Gadget columns filter ${run}`;

let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await createProjectFixture(client, {
		run,
		key,
		name: `Dashboard state ${run}`,
		issues: [
			{
				summary: `Race issue one ${run}`,
				status: "todo",
				storyPoints: 5,
				dueDate: "2026-02-03",
			},
			{ summary: `Race issue two ${run}`, status: "inProgress" },
			{ summary: `Race issue three ${run}`, status: "done" },
		],
	});
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from dashboards where name like $1", [`%${run}%`]);
	await client.query("delete from filters where name like $1", [`%${run}%`]);
	await dropProjectFixture(client, run);
	await client.end();
});

test("the manage page keeps its tab and search in the URL", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=/secure/ConfigurePortalPages!default.jspa",
	);
	await expect(
		page.getByRole("heading", { name: "Manage dashboards" }),
	).toBeVisible();

	const created = await page.request.post("/api/dashboards", {
		data: { name: manageName, shared: true },
		headers: { "x-requested-with": "rvna" },
	});
	expect(created.status()).toBe(201);

	await page.locator("nav.tabs").getByRole("link", { name: "Search" }).click();
	await expect(page).toHaveURL(/[?&]tab=search$/);
	await page.getByLabel("Search dashboards").fill(manageName);
	await page.getByRole("button", { name: "Search" }).click();
	await expect
		.poll(() => new URL(page.url()).searchParams.get("tab"))
		.toBe("search");
	await expect
		.poll(() => new URL(page.url()).searchParams.get("query"))
		.toBe(manageName);
	await expect(
		page.getByRole("link", { name: manageName, exact: true }),
	).toBeVisible();

	await page.reload();
	await expect(
		page.locator("nav.tabs").getByRole("link", { name: "Search" }),
	).toHaveAttribute("aria-current", "page");
	await expect(page.getByLabel("Search dashboards")).toHaveValue(manageName);
	await expect(
		page.getByRole("link", { name: manageName, exact: true }),
	).toBeVisible();
});

test("gadget columns render story points and format due dates", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/secure/Dashboard.jspa");

	const filter = await page.request.post("/api/filters", {
		data: {
			name: columnsFilterName,
			jql: `project = ${key} ORDER BY key ASC`,
			shared: true,
		},
		headers: { "x-requested-with": "rvna" },
	});
	expect(filter.status()).toBe(201);
	const filterId = ((await filter.json()) as { id: string }).id;

	const dashboard = await page.request.post("/api/dashboards", {
		data: { name: columnsName, shared: true },
		headers: { "x-requested-with": "rvna" },
	});
	expect(dashboard.status()).toBe(201);
	const dashboardId = ((await dashboard.json()) as { id: string }).id;

	const gadget = await page.request.post(
		`/api/dashboards/${dashboardId}/gadgets`,
		{
			data: {
				type: "filter-results",
				config: {
					filterId,
					columns: ["key", "dueDate", "storyPoints"],
					rows: 10,
				},
			},
			headers: { "x-requested-with": "rvna" },
		},
	);
	expect(gadget.status()).toBe(201);

	await page.goto(`/secure/Dashboard.jspa?selectPageId=${dashboardId}`);
	const card = page.locator("[data-gadget-id]").first();
	await expect(card.getByText(`${key}-1`, { exact: true })).toBeVisible();
	await expect(card.getByText("5", { exact: true })).toBeVisible();
	await expect(card.getByText("2026-02-03", { exact: true })).toHaveCount(0);
});

test("an older gadget refresh cannot overwrite a newer page", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/secure/Dashboard.jspa");

	const filter = await page.request.post("/api/filters", {
		data: {
			name: filterName,
			jql: `project = ${key} ORDER BY key ASC`,
			shared: true,
		},
		headers: { "x-requested-with": "rvna" },
	});
	expect(filter.status()).toBe(201);
	const filterId = ((await filter.json()) as { id: string }).id;

	const dashboard = await page.request.post("/api/dashboards", {
		data: { name: raceName, shared: true },
		headers: { "x-requested-with": "rvna" },
	});
	expect(dashboard.status()).toBe(201);
	const dashboardId = ((await dashboard.json()) as { id: string }).id;

	const gadget = await page.request.post(
		`/api/dashboards/${dashboardId}/gadgets`,
		{
			data: {
				type: "filter-results",
				config: { filterId, columns: ["key"], rows: 1 },
			},
			headers: { "x-requested-with": "rvna" },
		},
	);
	expect(gadget.status()).toBe(201);
	const gadgetId = ((await gadget.json()) as { id: string }).id;

	await page.goto(`/secure/Dashboard.jspa?selectPageId=${dashboardId}`);
	await expect(page.getByText(`${key}-1`, { exact: true })).toBeVisible();

	let releaseRefresh = () => {};
	const refreshGate = new Promise<void>((resolve) => {
		releaseRefresh = resolve;
	});
	await page.route(
		new RegExp(`/api/gadgets/${gadgetId}/data\\?startAt=0$`),
		async (route) => {
			await refreshGate;
			await route.continue();
		},
	);

	const refreshRequest = page.waitForRequest((request) =>
		request.url().includes(`/api/gadgets/${gadgetId}/data?startAt=0`),
	);
	await page.getByRole("button", { name: "Refresh Filter Results" }).click();
	await refreshRequest;

	await page.getByRole("button", { name: "Next page" }).click();
	await expect(page.getByText(`${key}-2`, { exact: true })).toBeVisible();

	const refreshResponse = page.waitForResponse((response) =>
		response.url().includes(`/api/gadgets/${gadgetId}/data?startAt=0`),
	);
	releaseRefresh();
	await refreshResponse;
	await expect(page.getByText(`${key}-2`, { exact: true })).toBeVisible();
	await expect(page.getByText(`${key}-1`, { exact: true })).toHaveCount(0);
});
