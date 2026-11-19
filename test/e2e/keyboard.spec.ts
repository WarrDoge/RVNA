import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	type SeedResult,
} from "../fixtures/project.ts";
import { expect, type Page, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const keyA = fixtureKey(run);
const keyB = `KB${run.slice(0, 5).toUpperCase()}`;
const navIssueKey = `${keyA}-51`;
const navIssueSummary = `Keyboard bulk 51 ${run}`;

let client: Client;
let projectA: SeedResult;

function jqlFromUrl(url: string) {
	return new URL(url).searchParams.get("jql") ?? "";
}

async function login(page: Page, returnTo: string) {
	await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}

async function openEditDialog(page: Page) {
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Edit Issue" });
	await expect(dialog).toBeVisible();
	return dialog;
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await client.query(
		`delete from user_preferences
		 where user_id in (select id from users where username = 'dev')`,
	);

	projectA = await createProjectFixture(client, {
		run,
		key: keyA,
		name: `Keyboard ${run}`,
		issues: Array.from({ length: 53 }, (_, index) => ({
			summary:
				index === 0
					? `Keyboard alpha ${run}`
					: index === 1
						? `Keyboard beta ${run}`
						: index === 2
							? `Keyboard gamma ${run}`
							: index === 51
								? `Keyboard selection one ${run}`
								: index === 52
									? `Keyboard selection two ${run}`
									: `Keyboard bulk ${String(index + 1).padStart(2, "0")} ${run}`,
		})),
	});
	await createProjectFixture(client, {
		run: `${run}b`,
		key: keyB,
		name: `Keyboard B ${run}`,
		issues: [
			{ summary: `Keyboard B one ${run}` },
			{ summary: `Keyboard B two ${run}` },
			{ summary: `Keyboard B three ${run}` },
		],
	});

	const subtaskType = await client.query<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, $2, true) returning id`,
		[`fixture:${run}:type:subtask`, `Keyboard subtask ${run}`],
	);
	await client.query(
		"update issues set type_id = $1, parent_id = $2 where id = $3",
		[subtaskType.rows[0]?.id, projectA.issueIds[0], projectA.issueIds[1]],
	);
	await client.query(
		`update issues
		 set original_estimate = 90, remaining_estimate = 90
		 where id = $1`,
		[projectA.issueIds[0]],
	);
});

test.afterAll(async () => {
	if (client) {
		await dropProjectFixture(client, run);
		await dropProjectFixture(client, `${run}b`);
		await client.query(
			`delete from user_preferences
			 where user_id in (select id from users where username = 'dev')`,
		);
		await client.end();
	}
});

test("editing an issue keeps a 90-second estimate", async ({ page }) => {
	await client.query(
		`update issues
		 set summary = $1, original_estimate = 90, remaining_estimate = 90
		 where id = $2`,
		[`Keyboard alpha ${run}`, projectA.issueIds[0]],
	);

	await login(page, `/browse/${keyA}-1`);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		`Keyboard alpha ${run}`,
	);

	const dialog = await openEditDialog(page);
	await dialog.getByLabel("Summary").fill(`Keyboard alpha edited ${run}`);
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();

	const response = await page.request.get(`/api/issues/${keyA}-1`);
	expect(response.ok()).toBe(true);
	const issue = (await response.json()) as {
		timeTracking: { originalEstimate: number | null };
	};
	expect(issue.timeTracking.originalEstimate).toBe(90);
});

test("edits, transitions and top-bar creates refresh the navigator list", async ({
	page,
}) => {
	await client.query(
		"delete from issues where project_id = $1 and summary like $2",
		[projectA.projectId, `Created in navigator ${run}%`],
	);
	await client.query(
		`update issues
		 set summary = $1, status_id = $2, resolution_id = null
		 where id = $3`,
		[navIssueSummary, projectA.statusIds.todo, projectA.issueIds[50]],
	);

	const jql = `project = ${keyA} ORDER BY key DESC`;
	await login(page, `/issues/?jql=${encodeURIComponent(jql)}&view=detail`);
	await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
	await page
		.getByRole("button", { name: new RegExp(navIssueKey) })
		.first()
		.click();
	await expect(
		page.getByRole("heading", { name: navIssueSummary }),
	).toBeVisible();

	const editedSummary = `Edited navigator ${run}`;
	const dialog = await openEditDialog(page);
	await dialog.getByLabel("Summary").fill(editedSummary);
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("button", { name: new RegExp(navIssueKey) }).first(),
	).toContainText(editedSummary);

	await page.getByRole("button", { name: "Close", exact: true }).click();
	await expect(page.getByTestId("issue-status")).toContainText(/done/i);

	await page.getByRole("button", { name: "List view" }).click();
	const row = page.locator("tbody tr", { hasText: navIssueKey });
	await expect(row).toContainText(editedSummary);
	await expect(row.getByText("Done", { exact: true }).first()).toBeVisible();

	const createdSummary = `Created in navigator ${run}`;
	await page.getByRole("button", { name: "Create", exact: true }).click();
	const createDialog = page.getByRole("dialog");
	await expect(createDialog).toBeVisible();
	await createDialog.getByLabel("Project").selectOption(keyA);
	await expect(createDialog.getByLabel("Issue Type")).not.toHaveValue("");
	await createDialog.getByLabel("Summary").fill(createdSummary);
	await createDialog
		.getByRole("button", { name: "Create", exact: true })
		.click();
	await expect(createDialog).toBeHidden();
	await expect(
		page.locator("tbody tr", { hasText: createdSummary }),
	).toBeVisible();
});

test("viewing an issue refreshes the Issues menu", async ({ page }) => {
	await client.query(
		`delete from issue_views
		 where user_id in (select id from users where username = 'dev')`,
	);

	await login(page, "/secure/Dashboard.jspa");
	const menuButton = page.getByRole("button", {
		name: "Issues",
		exact: true,
	});
	const recentResponse = page.waitForResponse((response) =>
		response.url().includes("/api/issues/recent?limit=5"),
	);
	await menuButton.click();
	await recentResponse;
	await expect(page.getByText("No recently viewed issues.")).toBeVisible();
	await page.keyboard.press("Escape");

	const search = page.getByLabel("Search", { exact: true });
	await search.fill(`${keyA}-4`);
	await search.press("Enter");
	await expect(page).toHaveURL(new RegExp(`/browse/${keyA}-4$`));
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		`Keyboard bulk 04 ${run}`,
	);

	await menuButton.click();
	const menu = page.getByRole("menu", { name: "Issues" });
	await expect(
		menu.getByRole("menuitem", { name: new RegExp(`${keyA}-4`) }),
	).toBeVisible();
});

test("quick search Enter opens the highlighted result", async ({ page }) => {
	await login(page, "/secure/Dashboard.jspa");
	const search = page.getByLabel("Search", { exact: true });
	await search.fill("Keyboard selection");
	const results = page.locator("#quicksearch-results [role='option']");
	await expect(results.nth(1)).toBeVisible();
	await search.press("ArrowDown");
	await expect(results.nth(1)).toHaveAttribute("aria-selected", "true");
	await search.press("Enter");
	await expect(page).toHaveURL(new RegExp(`/browse/${keyA}-53$`));
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		`Keyboard selection two ${run}`,
	);
});

test("Escape in a user picker keeps the edit dialog open", async ({ page }) => {
	await login(page, `/browse/${keyA}-1`);
	const dialog = await openEditDialog(page);
	await dialog.getByLabel("Assignee").click();
	const picker = dialog.getByRole("listbox", { name: "Assignee results" });
	await expect(picker).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("Escape in a mention dropdown keeps the edit dialog open", async ({
	page,
}) => {
	await login(page, `/browse/${keyA}-1`);
	const dialog = await openEditDialog(page);
	const editor = dialog.locator(".fat-editor-content").first();
	await editor.click();
	await page.keyboard.type("@");
	const mentions = dialog.getByRole("listbox", { name: "Mention a user" });
	await expect(mentions).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(mentions).toBeHidden();
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("Enter after ORDER BY key submits instead of accepting an operator", async ({
	page,
}) => {
	const jql = `project = ${keyA}`;
	await login(page, `/issues/?jql=${encodeURIComponent(jql)}&view=list`);
	const input = page.getByRole("textbox", { name: "Advanced search" });
	await input.fill(`project = ${keyA} ORDER BY key `);
	await expect(
		page.getByRole("option", { name: "=", exact: true }),
	).toHaveCount(0);
	await input.press("Enter");
	await expect
		.poll(() => jqlFromUrl(page.url()))
		.toMatch(new RegExp(`^project = ${keyA} ORDER BY key\\s*$`));
});

test("basic mode follows a standard filter", async ({ page }) => {
	const jql = `project = ${keyA} ORDER BY key ASC`;
	await login(page, `/issues/?jql=${encodeURIComponent(jql)}&view=list`);
	await page.getByRole("button", { name: "Basic", exact: true }).click();
	await expect(page.getByLabel("Project", { exact: true })).toHaveValue(keyA);

	await page.getByRole("button", { name: "Open issues", exact: true }).click();
	await expect(page.getByLabel("Project", { exact: true })).toHaveValue("");
	await expect(page.getByLabel("Resolution", { exact: true })).toHaveValue(
		"Unresolved",
	);

	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect
		.poll(() => jqlFromUrl(page.url()))
		.toBe("resolution = Unresolved ORDER BY priority DESC");
});

test("the project issue list resets paging when the project changes", async ({
	page,
}) => {
	await login(page, `/projects/${keyA}/issues`);
	await expect(page.getByText("1–50 of", { exact: false })).toBeVisible();
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await expect(page.getByText(/^51–\d+ of \d+$/)).toBeVisible();

	await page.evaluate((url) => {
		window.history.pushState({}, "", url);
		window.dispatchEvent(new PopStateEvent("popstate"));
	}, `/projects/${keyB}/issues`);

	await expect(page.getByText("1–3 of 3")).toBeVisible();
	await expect(page.getByText(`Keyboard B one ${run}`)).toBeVisible();
});

test("a subtask does not offer creating another sub-task", async ({ page }) => {
	await login(page, `/browse/${keyA}-2`);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		`Keyboard beta ${run}`,
	);
	await expect(page.getByText("Create sub-task", { exact: true })).toHaveCount(
		0,
	);

	await page.getByRole("button", { name: "More", exact: true }).click();
	await expect(
		page
			.getByRole("menu", { name: "More" })
			.getByRole("menuitem", { name: "Create sub-task" }),
	).toHaveCount(0);
});

test("double-clicking a transition sends only one request", async ({
	page,
}) => {
	await client.query(
		"update issues set status_id = $1, resolution_id = null where id = $2",
		[projectA.statusIds.todo, projectA.issueIds[2]],
	);

	await login(page, `/browse/${keyA}-3`);
	await expect(page.getByTestId("issue-status")).toContainText(/to do/i);

	let transitions = 0;
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			new URL(request.url()).pathname === `/api/issues/${keyA}-3/transitions`
		) {
			transitions += 1;
		}
	});

	await page.getByRole("button", { name: "Close", exact: true }).dblclick();
	await expect(page.getByTestId("issue-status")).toContainText(/done/i);
	await page.waitForTimeout(500);
	expect(transitions).toBe(1);
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Escape returns focus to the Assign trigger", async ({ page }) => {
	await login(page, `/browse/${keyA}-1`);
	const assign = page
		.getByRole("button", { name: "Assign", exact: true })
		.first();
	await expect(assign).toBeVisible();
	await assign.click();
	await expect(page.getByRole("textbox", { name: "Assignee" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(assign).toBeFocused();
});
