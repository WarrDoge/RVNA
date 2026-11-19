import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const softwareKey = `SB${run.slice(0, 4).toUpperCase()}`;
const deskKey = `SD${run.slice(0, 4).toUpperCase()}`;
const rapidViewId = 3_000_000 + Number.parseInt(run.slice(0, 6), 16);
const boardName = `Sidebar board ${run}`;
const queueName = `Sidebar queue ${run}`;
const portalName = `Sidebar portal ${run}`;

let client: Client;
let softwareProjectId: string;
let deskProjectId: string;
let deskId: string;
let queueId: string;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const software = await client.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'software', 0) returning id`,
		[`e2e:${run}:software-project`, softwareKey, `Sidebar software ${run}`],
	);
	softwareProjectId = software.rows[0].id;
	await client.query(
		`insert into boards
		 (rapid_view_id, source_id, name, type, filter_jql, project_id, config_imported)
		 values ($1, $2, $3, 'scrum', $4, $5, true)`,
		[
			rapidViewId,
			`e2e:${run}:board`,
			boardName,
			`project = ${softwareKey}`,
			softwareProjectId,
		],
	);

	const desk = await client.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'service_desk', 0) returning id`,
		[`e2e:${run}:desk-project`, deskKey, `Sidebar desk ${run}`],
	);
	deskProjectId = desk.rows[0].id;
	const deskRow = await client.query<{ id: string }>(
		`insert into service_desks
		 (source_id, project_id, portal_name, description, open_access)
		 values ($1, $2, $3, $4, true) returning id`,
		[`e2e:${run}:desk`, deskProjectId, portalName, "Sidebar end-to-end desk"],
	);
	deskId = deskRow.rows[0].id;
	const queue = await client.query<{ id: string }>(
		`insert into queues
		 (source_id, desk_id, name, jql, columns, issue_count, sequence)
		 values ($1, $2, $3, $4, $5::jsonb, 0, 0) returning id`,
		[
			`e2e:${run}:queue`,
			deskId,
			queueName,
			`project = ${deskKey}`,
			JSON.stringify(["issuekey", "summary"]),
		],
	);
	queueId = queue.rows[0].id;
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from boards where project_id = $1", [
		softwareProjectId,
	]);
	await client.query("delete from projects where id = any($1::uuid[])", [
		[softwareProjectId, deskProjectId],
	]);
	await client.end();
});

test("the project sidebar renders server-side, keeps its links and survives a reload", async ({
	page,
}) => {
	const consoleProblems: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleProblems.push(message.text());
	});
	page.on("pageerror", (error) => consoleProblems.push(error.message));

	const gallery = `/sk-sidebar?project=${softwareKey}&active=board`;
	await page.goto(`/auth/login?returnTo=${encodeURIComponent(gallery)}`);
	await expect(page).toHaveURL(
		new RegExp(`/sk-sidebar\\?project=${softwareKey}`),
	);

	const response = await page.request.get(gallery);
	expect(response.status()).toBe(200);
	const html = await response.text();
	expect(html).toContain(`Sidebar software ${run}`);
	expect(html).toContain('aria-label="Collapse sidebar"');
	expect(html).toContain(
		`href="/secure/RapidBoard.jspa?rapidView=${rapidViewId}"`,
	);
	expect(html).toContain(`href="/projects/${softwareKey}/issues"`);
	expect(html).toContain(
		`href="/plugins/servlet/project-config/${softwareKey}/summary"`,
	);
	expect(html).toContain('aria-current="page"');

	const sidebar = page.locator("aside");
	await expect(sidebar).toBeVisible();
	await expect(sidebar.getByRole("link", { name: "Backlog" })).toHaveAttribute(
		"href",
		`/secure/RapidBoard.jspa?rapidView=${rapidViewId}&view=planning`,
	);
	await expect(
		sidebar.getByRole("link", { name: "Active sprints" }),
	).toHaveAttribute("href", `/secure/RapidBoard.jspa?rapidView=${rapidViewId}`);
	await expect(sidebar.getByRole("link", { name: "Releases" })).toHaveAttribute(
		"href",
		`/secure/RapidBoard.jspa?rapidView=${rapidViewId}&view=releases`,
	);
	await expect(sidebar.getByRole("link", { name: "Reports" })).toHaveAttribute(
		"href",
		`/secure/RapidBoard.jspa?rapidView=${rapidViewId}&view=reporting`,
	);
	await expect(sidebar.getByRole("link", { name: "Issues" })).toHaveAttribute(
		"href",
		`/projects/${softwareKey}/issues`,
	);
	await expect(
		sidebar.getByRole("link", { name: "Project settings" }),
	).toHaveAttribute(
		"href",
		`/plugins/servlet/project-config/${softwareKey}/summary`,
	);
	await expect(
		sidebar.getByRole("link", { name: "Active sprints" }),
	).toHaveAttribute("aria-current", "page");

	const switcher = sidebar.getByRole("button", { name: boardName });
	await switcher.click();
	const menu = sidebar.getByRole("menu", { name: "Boards" });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole("menuitem", { name: boardName })).toHaveAttribute(
		"href",
		`/secure/RapidBoard.jspa?rapidView=${rapidViewId}`,
	);
	await expect(
		menu.getByRole("menuitem", { name: "View all boards" }),
	).toHaveAttribute("href", "/secure/ManageRapidViews.jspa");
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();

	await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
	await expect(
		sidebar.getByRole("button", { name: "Expand sidebar" }),
	).toBeVisible();
	expect(
		await page.evaluate(() =>
			window.localStorage.getItem("rvna.sidebarCollapsed"),
		),
	).toBe("1");

	await page.reload();
	const reloaded = page.locator("aside");
	await expect(
		reloaded.getByRole("button", { name: "Expand sidebar" }),
	).toBeVisible();
	await expect(reloaded.getByRole("link", { name: "Issues" })).toHaveAttribute(
		"href",
		`/projects/${softwareKey}/issues`,
	);

	await reloaded.getByRole("button", { name: "Expand sidebar" }).click();
	await expect(
		page.locator("aside").getByRole("button", { name: "Collapse sidebar" }),
	).toBeVisible();
	expect(
		await page.evaluate(() =>
			window.localStorage.getItem("rvna.sidebarCollapsed"),
		),
	).toBe("0");

	await page.goto(`/sk-sidebar?project=${deskKey}&active=queues`);
	const deskSidebar = page.locator("aside");
	await expect(
		deskSidebar.getByRole("link", { name: "Queues" }),
	).toHaveAttribute("href", `/projects/${deskKey}/queues/custom/${queueId}`);
	await expect(
		deskSidebar.getByRole("link", { name: queueName }),
	).toHaveAttribute("href", `/projects/${deskKey}/queues/custom/${queueId}`);
	await expect(
		deskSidebar.getByRole("link", { name: "Raise a request" }),
	).toHaveAttribute("href", `/servicedesk/customer/portal/${deskId}`);
	await expect(
		deskSidebar.getByRole("link", { name: "Active sprints" }),
	).toHaveCount(0);

	expect(consoleProblems).toEqual([]);
});
