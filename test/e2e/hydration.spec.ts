import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { Client } from "pg";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	type SeedResult,
} from "../fixtures/project.ts";
import { holdClientScripts, waitForHydration } from "./hydration.ts";

const run = randomUUID().slice(0, 8);
const key = fixtureKey(run);
const rapidViewId = 930000 + Number.parseInt(run.slice(0, 4), 16);
const requestTypeName = `Hydration Request ${run}`;
const summary = `Hydration summary ${run}`;
const nativeSummary = `Hydration native ${run}`;
const statusName = `Hydration Status ${run}`;
const spaceKey = `HS${run.slice(0, 4).toUpperCase()}`;
const pageTitle = `Hydration page ${run}`;

let client: Client;
let spaceId: string;
let schemeId: string;
let board: SeedResult;
let deskId: string;
let requestTypeId: string;
let issueTypeId: string;
let workflowId: string;
let statusId: string;
let deskProjectId: string;

async function login(page: Page) {
	// Log in through the request context so the page starts without a warm script cache.
	await page
		.context()
		.request.get("/auth/login?returnTo=/secure/Dashboard.jspa");
}

async function requestCount(summaryText: string) {
	const { rows } = await client.query<{ n: number }>(
		"select count(*)::int as n from issues where summary = $1",
		[summaryText],
	);
	return rows[0]?.n ?? 0;
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	board = await createProjectFixture(client, {
		run,
		key,
		name: `Hydration board ${run}`,
		issues: [
			{ summary: `Hydration board one ${run}` },
			{ summary: `Hydration board two ${run}` },
		],
	});
	await client.query(
		`insert into boards
			(rapid_view_id, source_id, name, type, filter_jql, project_id, config_imported)
		 values ($1, $2, $3, 'scrum', $4, $5, true)`,
		[
			rapidViewId,
			`e2e-hydration:${run}:board`,
			`Hydration board ${run}`,
			`project = ${key}`,
			board.projectId,
		],
	);

	const type = await client.query<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, $2, false) returning id`,
		[`e2e:${run}:desk-type`, requestTypeName],
	);
	issueTypeId = type.rows[0]?.id as string;
	const status = await client.query<{ id: string }>(
		`insert into statuses (source_id, name, category)
		 values ($1, $2, 'new') returning id`,
		[`e2e:${run}:desk-status`, `Hydration Open ${run}`],
	);
	statusId = status.rows[0]?.id as string;
	const workflow = await client.query<{ id: string }>(
		`insert into workflows (source_id, name) values ($1, $2) returning id`,
		[`e2e:${run}:desk-workflow`, `Hydration Workflow ${run}`],
	);
	workflowId = workflow.rows[0]?.id as string;
	await client.query(
		`insert into workflow_statuses (source_id, workflow_id, status_id)
		 values ($1, $2, $3)`,
		[`e2e:${run}:desk-workflow-status`, workflowId, statusId],
	);
	const project = await client.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'service_desk', 0) returning id`,
		[
			`e2e:${run}:desk-project`,
			`HD${run.slice(0, 4).toUpperCase()}`,
			`Hydration Desk ${run}`,
		],
	);
	deskProjectId = project.rows[0]?.id as string;
	await client.query(
		`insert into project_issue_types (source_id, project_id, issue_type_id)
		 values ($1, $2, $3)`,
		[`e2e:${run}:desk-project-type`, deskProjectId, issueTypeId],
	);
	await client.query(
		`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, null, $3)`,
		[`e2e:${run}:desk-project-workflow`, deskProjectId, workflowId],
	);
	const desk = await client.query<{ id: string }>(
		`insert into service_desks (source_id, project_id, portal_name)
		 values ($1, $2, $3) returning id`,
		[`e2e:${run}:desk`, deskProjectId, `Hydration Portal ${run}`],
	);
	deskId = desk.rows[0]?.id as string;
	const requestType = await client.query<{ id: string }>(
		`insert into request_types (source_id, desk_id, issue_type_id, name, sequence)
		 values ($1, $2, $3, $4, 0) returning id`,
		[`e2e:${run}:request-type`, deskId, issueTypeId, requestTypeName],
	);
	requestTypeId = requestType.rows[0]?.id as string;
	await client.query(
		`insert into request_type_fields (request_type_id, field_id, label, required, sequence)
		 values ($1, 'summary', 'Summary', true, 0), ($1, 'attachment', 'Attachment', false, 1), ($1, 'description', 'Description', false, 2)`,
		[requestTypeId],
	);

	await client.query(
		`insert into statuses (source_id, name, category)
		 values ($1, $2, 'new')`,
		[`e2e:${run}:filter-status`, statusName],
	);

	const dev = await client.query<{ id: string }>(
		"select id from users where username = 'dev'",
	);
	const space = await client.query<{ id: string }>(
		`insert into spaces (source_id, key, name, type)
		 values ($1, $2, $3, 'global') returning id`,
		[`e2e:${run}:space`, spaceKey, `Hydration space ${run}`],
	);
	spaceId = space.rows[0]?.id as string;
	await client.query(
		`insert into pages
			(source_id, space_id, title, type, status, body_html, created, updated, creator_id)
		 values ($1, $2, $3, 'page', 'current', '<p>Hydration body</p>', now(), now(), $4)`,
		[`e2e:${run}:page`, spaceId, pageTitle, dev.rows[0]?.id ?? null],
	);

	const scheme = await client.query<{ id: string }>(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, '[]'::jsonb, '{}'::jsonb) returning id`,
		[`e2e:${run}:scheme`, `Hydration scheme ${run}`],
	);
	schemeId = scheme.rows[0]?.id as string;
	await client.query(
		`insert into permission_grants
			(source_id, scheme_id, permission_key, holder_type, holder_parameter, raw)
		 values ($1, $2, 'BROWSE_PROJECTS', 'group', 'hydration-group', '{}'::jsonb)`,
		[`e2e:${run}:grant`, schemeId],
	);
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from boards where source_id = $1", [
		`e2e-hydration:${run}:board`,
	]);
	await client.query("delete from statuses where source_id = $1", [
		`e2e:${run}:filter-status`,
	]);
	await client.query("delete from spaces where id = $1", [spaceId]);
	await client.query("delete from permission_grants where scheme_id = $1", [
		schemeId,
	]);
	await client.query("delete from permission_schemes where id = $1", [
		schemeId,
	]);
	await client.query("delete from projects where id = $1", [deskProjectId]);
	await dropProjectFixture(client, run);
	await client.query("delete from workflows where id = $1", [workflowId]);
	await client.query("delete from statuses where id = $1", [statusId]);
	await client.query("delete from issue_types where id = $1", [issueTypeId]);
	await client.end();
});

test("service desk text and file survive hydration, then the request is created", async ({
	page,
}) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto(
		`/servicedesk/customer/portal/${deskId}/create/${requestTypeId}`,
	);
	const summaryInput = page.locator("#field-summary");
	await summaryInput.fill(summary);
	await page.locator("#portal-attachment").setInputFiles({
		name: "hydration.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("hydration"),
	});
	await expect(summaryInput).toHaveValue(summary);

	await gate.hydrate();

	await expect(summaryInput).toHaveValue(summary);
	await expect(page.locator(".file-label")).toContainText("1 file attached");
	await page.getByRole("button", { name: "Send" }).click();
	await expect(page).toHaveURL(
		new RegExp(
			`/servicedesk/customer/portal/${deskId}/HD${run.slice(0, 4).toUpperCase()}-\\d+(\\?.*)?$`,
		),
	);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(summary);
	expect(await requestCount(summary)).toBe(1);
	const { rows } = await client.query<{ n: number }>(
		`select count(*)::int as n
		 from attachments a join issues i on i.id = a.issue_id
		 where i.summary = $1`,
		[summary],
	);
	expect(rows[0]?.n).toBe(1);
});

test("native Send before hydration redirects to the created request with its file", async ({
	page,
}) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto(
		`/servicedesk/customer/portal/${deskId}/create/${requestTypeId}`,
	);
	await page.getByLabel("Summary").fill(nativeSummary);
	await page.locator("#portal-attachment").setInputFiles({
		name: "native.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("native"),
	});
	await page.getByRole("button", { name: "Send" }).click();

	await expect(page).toHaveURL(
		new RegExp(
			`/servicedesk/customer/portal/${deskId}/HD${run.slice(0, 4).toUpperCase()}-\\d+(\\?.*)?$`,
		),
	);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		nativeSummary,
	);
	expect(await requestCount(nativeSummary)).toBe(1);
	const { rows } = await client.query<{ n: number }>(
		`select count(*)::int as n
		 from attachments a join issues i on i.id = a.issue_id
		 where i.summary = $1`,
		[nativeSummary],
	);
	expect(rows[0]?.n).toBe(1);
	await gate.hydrate();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		nativeSummary,
	);
});

test("quick search keeps typed text and runs the search", async ({ page }) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto("/secure/Dashboard.jspa");
	const search = page.getByLabel("Search", { exact: true });
	await search.fill(`${key}-1`);
	await expect(search).toHaveValue(`${key}-1`);

	await gate.hydrate();

	await expect(search).toHaveValue(`${key}-1`);
	await expect(
		page.locator("#quicksearch-results [role='option']").first(),
	).toContainText(`${key}-1`);
	await search.press("Enter");
	await expect(page).toHaveURL(new RegExp(`/browse/${key}-1$`));
});

test("board search keeps typed text and filters the backlog", async ({
	page,
}) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto(
		`/secure/RapidBoard.jspa?rapidView=${rapidViewId}&view=planning`,
	);
	const search = page.getByLabel("Search board");
	await search.fill("board one");
	await expect(search).toHaveValue("board one");

	await gate.hydrate();

	await expect(search).toHaveValue("board one");
	await expect
		.poll(() => new URL(page.url()).searchParams.get("text"))
		.toBe("board one");
	await expect(page.getByTestId(`backlog-row-${key}-1`)).toBeVisible();
	await expect(page.getByTestId(`backlog-row-${key}-2`)).toHaveCount(0);
});

test("shared SearchField keeps a filter typed before hydration", async ({
	page,
}) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto("/secure/admin/ViewStatuses.jspa");
	const filter = page.getByLabel("Filter statuses");
	await filter.fill(statusName);

	await gate.hydrate();

	await expect(filter).toHaveValue(statusName);
	await expect(
		page.getByRole("row").filter({ hasText: statusName }),
	).toHaveCount(1);
});

for (const [path, label, param] of [
	[
		"/secure/ManageFilters.jspa?tab=search&query=alpha",
		"Search filters",
		"query",
	],
	["/search?q=alpha", "Search all content", "q"],
] as const) {
	test(`${label} keeps typed text and submits it`, async ({ page }) => {
		await login(page);
		const gate = await holdClientScripts(page);
		await page.goto(path);
		const field = page.getByLabel(label);
		await field.fill("beta");

		await gate.hydrate();

		await expect(field).toHaveValue("beta");
		await field.press("Enter");
		await expect
			.poll(() => new URL(page.url()).searchParams.get(param))
			.toBe("beta");
		await page.goBack();
		await expect(field).toHaveValue("alpha");
	});
}

test.describe("first visit from a time zone other than the server's", () => {
	// The page then refreshes its data once after hydration; typed text must survive that.
	test.use({ timezoneId: "Pacific/Auckland" });

	test("wiki search keeps the typed filters and runs the search", async ({
		page,
	}) => {
		await login(page);
		// The dev user exists only after the first sign-in, which may be this one.
		await client.query(
			`update pages set creator_id = (select id from users where username = 'dev')
			 where source_id = $1`,
			[`e2e:${run}:page`],
		);
		const gate = await holdClientScripts(page);
		await page.goto("/dosearchsite.action");
		const query = page.locator('input[name="queryString"]');
		const contributor = page.locator('input[name="contributor"]');
		const from = page.locator('input[name="from"]');
		const to = page.locator('input[name="to"]');
		const space = page.locator('select[name="space"]');
		const typed = `Hydration${run}`;
		await query.fill(typed);
		await contributor.fill("dev");
		await from.fill("2025-01-01");
		await to.fill("2027-01-01");
		await space.selectOption(spaceKey);

		await gate.hydrate();

		await expect(query).toHaveValue(typed);
		await expect(contributor).toHaveValue("dev");
		await expect(from).toHaveValue("2025-01-01");
		await expect(to).toHaveValue("2027-01-01");
		await expect(space).toHaveValue(spaceKey);
		await page.getByRole("button", { name: "Search" }).click();
		await expect
			.poll(() => new URL(page.url()).searchParams.get("queryString"))
			.toBe(typed);
		await expect
			.poll(() => new URL(page.url()).searchParams.get("space"))
			.toBe(spaceKey);
		await expect
			.poll(() => new URL(page.url()).searchParams.get("contributor"))
			.toBe("dev");
		await expect
			.poll(() => new URL(page.url()).searchParams.get("from"))
			.toBe("2025-01-01");
		await expect
			.poll(() => new URL(page.url()).searchParams.get("to"))
			.toBe("2027-01-01");
		await expect(page.getByRole("heading", { name: pageTitle })).toBeVisible();
	});

	test("messenger settings keep typed values through hydration and the refresh", async ({
		page,
	}) => {
		await login(page);
		const gate = await holdClientScripts(page);
		await page.goto("/plugins/servlet/messenger");
		const address = page.getByLabel("Homeserver URL");
		const desk = page.getByLabel("Service desk");
		const enabled = page.getByLabel("Enabled");
		await address.fill("https://matrix.example.test");
		await desk.selectOption(deskId);
		await enabled.check();

		await gate.hydrate();

		await expect(address).toHaveValue("https://matrix.example.test");
		await expect(desk).toHaveValue(deskId);
		await expect(enabled).toBeChecked();
		const requestType = page.getByLabel("Request type");
		await requestType.selectOption(requestTypeId);
		await expect(requestType).toHaveValue(requestTypeId);
	});

	test("permission scheme keeps an open removal confirmation when the refresh lands", async ({
		page,
	}) => {
		await login(page);
		let releaseRefresh!: () => void;
		const refreshGate = new Promise<void>((resolve) => {
			releaseRefresh = resolve;
		});
		await page.route(/__data\.json/, async (route) => {
			await refreshGate;
			await route.continue();
		});
		const gate = await holdClientScripts(page);
		await page.goto(`/secure/admin/ViewPermissionScheme.jspa?id=${schemeId}`);
		await gate.hydrate();

		await page.getByRole("button", { name: "Remove" }).click();
		const dialog = page.getByRole("dialog", {
			name: "Remove permission grant",
		});
		await expect(dialog).toBeVisible();

		const refreshed = page.waitForResponse(/__data\.json/);
		releaseRefresh();
		await refreshed;
		await page.waitForTimeout(500);

		await expect(dialog).toBeVisible();
	});
});

test("messenger settings show the saved desk and request type after hydration", async ({
	page,
}) => {
	await login(page);
	await client.query(
		`insert into messenger_config (id, service_desk_id, request_type_id)
		 values (1, $1, $2)
		 on conflict (id) do update
		 set service_desk_id = $1, request_type_id = $2`,
		[deskId, requestTypeId],
	);
	try {
		const gate = await holdClientScripts(page);
		await page.goto("/plugins/servlet/messenger");
		await gate.hydrate();

		await expect(page.getByLabel("Service desk")).toHaveValue(deskId);
		await expect(page.getByLabel("Request type")).toHaveValue(requestTypeId);
	} finally {
		await client.query("delete from messenger_config where id = 1");
	}
});

// A link click inside the app mounts the page without server HTML to adopt.
async function clientNavigate(page: Page, href: string) {
	await page.evaluate((target) => {
		const link = document.createElement("a");
		link.href = target;
		link.textContent = "hydration test link";
		document.body.append(link);
	}, href);
	await page.getByRole("link", { name: "hydration test link" }).last().click();
}

test("selects show the loaded value after a navigation inside the app", async ({
	page,
}) => {
	await login(page);
	await page.goto("/secure/Dashboard.jspa");
	await waitForHydration(page);

	await clientNavigate(
		page,
		`/dosearchsite.action?queryString=Hydration&space=${spaceKey}`,
	);
	await expect(page).toHaveURL(/dosearchsite/);
	await expect(page.locator('select[name="space"]')).toHaveValue(spaceKey);

	await clientNavigate(
		page,
		`/boards/${rapidViewId}/reports?chart=velocityChart&estimation=issue_count`,
	);
	await expect(page).toHaveURL(/estimation=issue_count/);
	await expect(page.getByLabel("Estimation statistic")).toHaveValue(
		"issue_count",
	);
});

test("move page keeps a position picked before hydration", async ({ page }) => {
	await login(page);
	const { rows } = await client.query<{ id: string }>(
		"select id from pages where source_id = $1",
		[`e2e:${run}:page`],
	);
	const gate = await holdClientScripts(page);
	await page.goto(`/pages/movepage.action?pageId=${rows[0]?.id}`);
	const first = page.locator('input[name="move-position"]').first();
	await first.check();

	await gate.hydrate();

	await expect(first).toBeChecked();
});

test("my requests keeps the typed search and applies it", async ({ page }) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto("/servicedesk/customer/user/requests");
	const query = page.getByLabel("Search requests");
	const typed = `Hydration request ${run}`;
	await query.fill(typed);

	await gate.hydrate();

	await expect(query).toHaveValue(typed);
	await query.press("Enter");
	await expect
		.poll(() => new URL(page.url()).searchParams.get("q"))
		.toBe(typed);
	await expect(page.getByLabel("Search requests")).toHaveValue(typed);
});

test("project filter keeps the typed text and applies it", async ({ page }) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto("/secure/project/ViewProjects.jspa");
	const query = page.getByLabel("Filter projects");
	await query.fill(key);

	await gate.hydrate();

	await expect(query).toHaveValue(key);
	await query.press("Enter");
	await expect
		.poll(() => new URL(page.url()).searchParams.get("query"))
		.toBe(key);
	await expect(
		page.getByRole("cell", { name: key, exact: true }),
	).toBeVisible();
});

test("dashboard search keeps the typed text and applies it", async ({
	page,
}) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto("/secure/ConfigurePortalPages!default.jspa?tab=search");
	const query = page.getByLabel("Search dashboards");
	const typed = `Hydration dashboard ${run}`;
	await query.fill(typed);

	await gate.hydrate();

	await expect(query).toHaveValue(typed);
	await query.press("Enter");
	await expect
		.poll(() => new URL(page.url()).searchParams.get("query"))
		.toBe(typed);
	await expect(page.getByLabel("Search dashboards")).toHaveValue(typed);
});

test("rich text text-style select keeps a pre-hydration choice", async ({
	page,
}) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto(
		`/servicedesk/customer/portal/${deskId}/create/${requestTypeId}`,
	);
	const style = page.getByLabel("Text style");
	await style.selectOption("h2");

	await gate.hydrate();

	await expect(style).toHaveValue("h2");
	const editor = page.locator(".fat-editor .ProseMirror").first();
	await editor.click();
	await editor.pressSequentially("Style text");
	await style.selectOption("h1");
	await expect(editor.locator("h1")).toHaveText("Style text");
});

test("project lead search keeps text typed before hydration", async ({
	page,
}) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto(`/plugins/servlet/project-config/${key}/summary`);
	const lead = page.getByLabel("Project lead");
	await lead.fill("dev");

	await gate.hydrate();

	await expect(lead).toHaveValue("dev");
	await lead.fill("dev");
	await expect(
		page.getByRole("listbox", { name: "Project lead results" }),
	).toBeVisible();
});

test("report estimation select keeps a pre-hydration choice", async ({
	page,
}) => {
	await login(page);
	const gate = await holdClientScripts(page);
	await page.goto(`/boards/${rapidViewId}/reports?chart=velocityChart`);
	const select = page.getByLabel("Estimation statistic");
	await select.selectOption("issue_count");

	await gate.hydrate();

	await expect(select).toHaveValue("issue_count");
	await select.selectOption("original_estimate");
	await expect
		.poll(() => new URL(page.url()).searchParams.get("estimation"))
		.toBe("original_estimate");
});

test("notification settings show the saved values and disable Save after saving", async ({
	page,
}) => {
	await page.goto(
		"/auth/login?returnTo=/secure/ViewProfile.jspa%3FselectedTab%3Dnotifications",
	);
	const autowatch = page.getByLabel("Autowatch");
	await expect(autowatch).toBeVisible();
	await waitForHydration(page);
	const startAuto = await autowatch.isChecked();
	const plain = page.getByRole("radio", { name: "Plain text" });
	const startPlain = await plain.isChecked();
	await autowatch.setChecked(!startAuto);
	await page
		.getByRole("radio", { name: startPlain ? "HTML" : "Plain text" })
		.check();
	const save = page.getByRole("button", { name: "Save" }).first();
	await save.click();
	await expect(
		page.getByText("Your notification settings were saved.").first(),
	).toBeVisible();
	await expect(save).toBeDisabled();
	await expect(autowatch).toBeChecked({ checked: !startAuto });
	await expect(plain).toBeChecked({ checked: !startPlain });
	await page.reload();
	await expect(page.getByLabel("Autowatch")).toBeChecked({
		checked: !startAuto,
	});
	await expect(page.getByRole("radio", { name: "Plain text" })).toBeChecked({
		checked: !startPlain,
	});
});
