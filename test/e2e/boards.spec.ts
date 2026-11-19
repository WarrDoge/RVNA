import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const projectKey = `EB${run.slice(0, 4).toUpperCase()}`;
const rapidViewId = 900000 + Number.parseInt(run.slice(0, 4), 16);
const tag = `e2e-boards-${run}`;

let client: Client;
let projectId: string;
let boardId: string;

async function query<T extends Record<string, unknown>>(
	text: string,
	values: unknown[] = [],
) {
	const result = await client.query<T>(text, values);
	return result.rows;
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const typeRows = await query<{ id: string }>(
		`insert into issue_types (source_id, name) values ($1, 'Task') returning id`,
		[`${tag}:type`],
	);
	const typeId = typeRows[0].id;

	const statusRows = await query<{ id: string; name: string }>(
		`insert into statuses (source_id, name, category) values
			($1, 'To Do', 'new'),
			($2, 'In Progress', 'indeterminate'),
			($3, 'Done', 'done')
		 returning id, name`,
		[`${tag}:todo`, `${tag}:progress`, `${tag}:done`],
	);
	const todo = statusRows.find((row) => row.name === "To Do")?.id as string;
	const progress = statusRows.find((row) => row.name === "In Progress")
		?.id as string;
	const done = statusRows.find((row) => row.name === "Done")?.id as string;

	const workflowRows = await query<{ id: string }>(
		`insert into workflows (source_id, name) values ($1, $2) returning id`,
		[`${tag}:workflow`, `${tag} workflow`],
	);
	const workflowId = workflowRows[0].id;
	await client.query(
		`insert into workflow_statuses (workflow_id, status_id) values
			($1, $2), ($1, $3), ($1, $4)`,
		[workflowId, todo, progress, done],
	);
	await client.query(
		`insert into workflow_transitions
			(source_id, workflow_id, name, from_status_id, to_status_id, sequence)
		 values
			($1, $4, 'Start progress', $2, $3, 0),
			($5, $4, 'Finish', $3, $6, 1),
			($7, $4, 'Close', $2, $6, 2)`,
		[`${tag}:t1`, todo, progress, workflowId, `${tag}:t2`, done, `${tag}:t3`],
	);

	const projectRows = await query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'software', 3) returning id`,
		[`${tag}:project`, projectKey, `E2E boards ${run}`],
	);
	projectId = projectRows[0].id;
	await client.query(
		`insert into project_issue_types (source_id, project_id, issue_type_id)
		 values ($1, $2, $3)`,
		[`${tag}:project-type`, projectId, typeId],
	);
	await client.query(
		`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, null, $3)`,
		[`${tag}:project-workflow`, projectId, workflowId],
	);

	const boardRows = await query<{ id: string }>(
		`insert into boards
			(rapid_view_id, source_id, name, type, filter_jql, project_id, config_imported)
		 values ($1, $2, $3, 'scrum', $4, $5, true) returning id`,
		[
			rapidViewId,
			`${tag}:board`,
			"E2E sprint board",
			`project = ${projectKey}`,
			projectId,
		],
	);
	boardId = boardRows[0].id;

	for (const [sequence, name, statusId] of [
		[0, "To Do", todo],
		[1, "In Progress", progress],
		[2, "Done", done],
	] as const) {
		const columnRows = await query<{ id: string }>(
			`insert into board_columns (board_id, name, sequence)
			 values ($1, $2, $3) returning id`,
			[boardId, name, sequence],
		);
		await client.query(
			`insert into board_column_statuses (column_id, status_id, sequence)
			 values ($1, $2, 0)`,
			[columnRows[0].id, statusId],
		);
	}
	await client.query(
		`insert into board_columns (board_id, name, sequence)
		 values ($1, 'Review', 3)`,
		[boardId],
	);
	await client.query(
		`update board_columns set name = 'Waiting for acceptance by the external review board'
		 where board_id = $1 and name = 'Review'`,
		[boardId],
	);

	for (let index = 1; index <= 3; index += 1) {
		await client.query(
			`insert into issues
				(source_id, project_id, number, key, type_id, status_id, summary, rank)
			 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				`${tag}:issue-${index}`,
				projectId,
				index,
				`${projectKey}-${index}`,
				typeId,
				todo,
				`E2E board issue ${index}`,
				`0|a${index}`,
			],
		);
	}

	const epicRows = await query<{ id: string }>(
		`insert into issues
			(source_id, project_id, number, key, type_id, status_id, summary, rank)
		 values ($1, $2, 10, $3, $4, $5, $6, $7) returning id`,
		[
			`${tag}:epic`,
			projectId,
			`${projectKey}-10`,
			typeId,
			todo,
			"E2E epic with a summary long enough to overflow a narrow card",
			"0|z",
		],
	);
	await client.query(`update issues set epic_id = $1 where key = $2`, [
		epicRows[0].id,
		`${projectKey}-1`,
	]);
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from boards where source_id = $1", [
		`${tag}:board`,
	]);
	await client.query("delete from projects where id = $1", [projectId]);
	await client.query("delete from workflows where source_id = $1", [
		`${tag}:workflow`,
	]);
	await client.query("delete from statuses where source_id like $1", [
		`${tag}%`,
	]);
	await client.query("delete from issue_types where source_id like $1", [
		`${tag}%`,
	]);
	await client.end();
});

test("drag a card, reorder the backlog, start and complete a sprint", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(
			`/secure/RapidBoard.jspa?rapidView=${rapidViewId}&view=planning`,
		)}`,
	);
	await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();

	await page.getByRole("button", { name: "Create sprint" }).click();
	const createDialog = page.getByRole("dialog");
	await expect(createDialog).toBeVisible();
	await createDialog.getByLabel("Sprint name").fill("Sprint 1");
	await createDialog
		.getByRole("button", { name: "Create", exact: true })
		.click();
	await expect(createDialog).toBeHidden();

	const sprint = page
		.locator('[data-testid^="backlog-sprint-section-"]')
		.first();
	await expect(sprint).toContainText("Sprint 1");

	await page.getByTestId(`backlog-row-${projectKey}-1`).dragTo(sprint);
	await page.getByTestId(`backlog-row-${projectKey}-2`).dragTo(sprint);
	await expect(sprint.getByTestId(`backlog-row-${projectKey}-1`)).toBeVisible();
	await expect(sprint.getByTestId(`backlog-row-${projectKey}-2`)).toBeVisible();

	await sprint.getByRole("button", { name: "Start sprint" }).click();
	const startDialog = page.getByRole("dialog");
	await expect(startDialog).toBeVisible();
	await startDialog.getByRole("button", { name: "Start", exact: true }).click();
	await expect(startDialog).toBeHidden();

	await page.getByRole("link", { name: "Active sprints" }).click();
	await expect(page.getByRole("heading", { name: "Sprint 1" })).toBeVisible();
	await expect(page.getByTestId(`board-card-${projectKey}-1`)).toBeVisible();

	const inProgress = page.locator('[data-testid^="board-column-"]').nth(1);
	await page.getByTestId(`board-card-${projectKey}-1`).dragTo(inProgress);
	await page.reload();
	await expect(
		page
			.locator('[data-testid^="board-column-"]')
			.nth(1)
			.getByTestId(`board-card-${projectKey}-1`),
	).toBeVisible();

	await page.getByRole("link", { name: "Backlog" }).click();
	const sprintAgain = page
		.locator('[data-testid^="backlog-sprint-section-"]')
		.first();
	await page
		.getByTestId(`backlog-row-${projectKey}-2`)
		.dragTo(page.getByTestId(`backlog-row-${projectKey}-1`));
	await expect
		.poll(async () =>
			sprintAgain
				.locator('[data-testid^="backlog-row-"]')
				.evaluateAll((rows) =>
					rows.map((row) => row.getAttribute("data-testid")),
				),
		)
		.toEqual([`backlog-row-${projectKey}-2`, `backlog-row-${projectKey}-1`]);

	await page.getByRole("link", { name: "Active sprints" }).click();
	const done = page.locator('[data-testid^="board-column-"]').nth(2);
	await page.getByTestId(`board-card-${projectKey}-2`).dragTo(done);
	await page.reload();
	await expect(
		page
			.locator('[data-testid^="board-column-"]')
			.nth(2)
			.getByTestId(`board-card-${projectKey}-2`),
	).toBeVisible();

	await page.getByRole("button", { name: "Complete sprint" }).click();
	const completeDialog = page.getByRole("dialog");
	await expect(completeDialog).toBeVisible();
	await completeDialog
		.getByRole("button", { name: "Complete sprint", exact: true })
		.click();
	await expect(completeDialog).toContainText("1 issue completed");
	await expect(completeDialog).toContainText(
		"1 incomplete issue moved to the backlog",
	);
	await completeDialog.getByRole("button", { name: "Done" }).click();

	await page.getByRole("link", { name: "Backlog" }).click();
	await expect(page.getByTestId(`backlog-row-${projectKey}-1`)).toBeVisible();
	await expect(page.getByTestId(`backlog-row-${projectKey}-2`)).toHaveCount(0);
});

test("the board columns shrink when the issue panel is open", async ({
	page,
}) => {
	const sprintRows = await query<{ id: string }>(
		`insert into sprints
			(source_id, board_id, name, state, start_date, end_date, sequence)
		 values ($1, $2, $3, 'active', now(), now() + interval '14 days', 0)
		 returning id`,
		[`${tag}:layout-sprint`, boardId, "Layout sprint"],
	);
	await client.query(
		`insert into issue_sprints (issue_id, sprint_id, is_open)
		 select id, $1, true from issues where project_id = $2`,
		[sprintRows[0].id, projectId],
	);
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(
			`/secure/RapidBoard.jspa?rapidView=${rapidViewId}&selectedIssue=${projectKey}-1`,
		)}`,
	);
	await expect(page.locator(".issue-panel")).toBeVisible();
	const overflow = await page
		.locator(".board-scroll")
		.evaluate((element) => element.scrollWidth - element.clientWidth);
	expect(overflow).toBeLessThanOrEqual(1);
});

test("board columns keep a 160px minimum and card content stays inside", async ({
	page,
}) => {
	const sprintRows = await query<{ id: string }>(
		`insert into sprints
			(source_id, board_id, name, state, start_date, end_date, sequence)
		 values ($1, $2, $3, 'active', now(), now() + interval '14 days', 9)
		 returning id`,
		[`${tag}:geometry-sprint-${randomUUID()}`, boardId, "Geometry sprint"],
	);
	await client.query(
		`insert into issue_sprints (issue_id, sprint_id, is_open)
		 select id, $1, true from issues where project_id = $2
		 on conflict do nothing`,
		[sprintRows[0].id, projectId],
	);
	await page.setViewportSize({ width: 600, height: 900 });
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(
			`/secure/RapidBoard.jspa?rapidView=${rapidViewId}`,
		)}`,
	);
	const card = page.getByTestId(`board-card-${projectKey}-1`);
	await expect(card).toBeVisible();

	const overflow = await page
		.locator(".board-scroll")
		.evaluate((element) => element.scrollWidth - element.clientWidth);
	expect(overflow).toBeGreaterThan(0);

	const columnWidths = await page
		.locator(".column-header")
		.evaluateAll((elements) =>
			elements.map((element) => element.getBoundingClientRect().width),
		);
	expect(columnWidths.length).toBe(4);
	expect(columnWidths.every((width) => width >= 160)).toBe(true);

	const title = page.locator(".column-title .name").last();
	expect(
		await title.evaluate((element) => element.getClientRects().length),
	).toBe(1);
	const titleOverflow = await title.evaluate(
		(element) => element.scrollWidth > element.clientWidth,
	);
	expect(titleOverflow).toBe(true);
	await expect(page.locator(".column-title .count").last()).toBeVisible();

	const lozenge = card.locator(".epic-lozenge");
	await expect(lozenge).toBeVisible();
	const [lozengeBox, cardBox] = await Promise.all([
		lozenge.boundingBox(),
		card.boundingBox(),
	]);
	if (!lozengeBox || !cardBox) throw new Error("The card geometry is missing");
	expect(lozengeBox.x).toBeGreaterThanOrEqual(cardBox.x);
	expect(lozengeBox.x + lozengeBox.width).toBeLessThanOrEqual(
		cardBox.x + cardBox.width,
	);
	const lozengeOverflow = await lozenge.evaluate(
		(element) => element.scrollWidth > element.clientWidth,
	);
	expect(lozengeOverflow).toBe(true);
});

test("deleting from the backlog detail panel removes the row", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(
			`/secure/RapidBoard.jspa?rapidView=${rapidViewId}&view=planning`,
		)}`,
	);
	await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();

	await page.getByTestId(`backlog-row-${projectKey}-1`).dblclick();
	const panel = page.getByTestId("issue-detail-panel");
	await expect(
		panel.getByRole("heading", { name: "E2E board issue 1" }),
	).toBeVisible();

	await panel.getByRole("button", { name: "More", exact: true }).click();
	await page
		.getByRole("menu", { name: "More" })
		.getByRole("menuitem", { name: "Delete" })
		.click();
	await page
		.getByRole("dialog", { name: "Delete issue" })
		.getByRole("button", { name: "Delete" })
		.click();

	await expect(page.getByTestId(`backlog-row-${projectKey}-1`)).toHaveCount(0);
});

test("the project sidebar on an issue page links to the project's board", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(`/browse/${projectKey}-3`)}`,
	);
	const board = `/secure/RapidBoard.jspa?rapidView=${rapidViewId}`;
	await expect(page.getByRole("link", { name: "Backlog" })).toHaveAttribute(
		"href",
		`${board}&view=planning`,
	);
	await expect(
		page.getByRole("link", { name: "Active sprints" }),
	).toHaveAttribute("href", board);
	await expect(page.getByRole("link", { name: "Releases" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Reports" })).toBeVisible();
	await expect(
		page.getByRole("button", { name: /E2E sprint board/ }),
	).toBeVisible();
});

test("typing in the board configuration fields does not crash the page", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(`/secure/RapidView.jspa?rapidView=${rapidViewId}`)}`,
	);
	await page.getByRole("button", { name: "Quick Filters" }).click();
	await page.getByRole("button", { name: "Add quick filter" }).click();
	const jql = page.getByLabel("Quick filter JQL 1");
	await jql.fill("");
	await jql.pressSequentially("assignee = currentUser()");
	await expect(jql).toHaveValue("assignee = currentUser()");
	await expect(page.getByText("Something went wrong")).toHaveCount(0);
});

test("the board menu opens create board with the board's project selected", async ({
	page,
}) => {
	const projectRequests: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/api/projects") {
			projectRequests.push(request.url());
		}
	});
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(
			`/secure/RapidBoard.jspa?rapidView=${rapidViewId}`,
		)}`,
	);
	await page.getByRole("button", { name: "Board", exact: true }).click();
	await page.getByRole("menuitem", { name: "Create board" }).click();
	await expect(page).toHaveURL(
		new RegExp(`/secure/ManageRapidViews\\.jspa\\?project=${projectKey}$`),
	);
	await page.waitForLoadState("networkidle");
	await page.getByRole("button", { name: "Create board" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel("Board project")).toHaveValue(projectKey);
	expect(projectRequests).toEqual([]);
});

test("a status can be moved between columns with the keyboard", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(
			`/secure/RapidView.jspa?rapidView=${rapidViewId}&tab=columns`,
		)}`,
	);
	const todo = page.getByRole("button", { name: "To Do", exact: true });
	await todo.focus();
	await todo.press("Space");
	await todo.press("ArrowRight");
	await todo.press("Space");
	const progress = page.getByRole("group", { name: "Column In Progress" });
	await expect(
		progress.getByRole("button", { name: "To Do", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	await page.reload();
	await expect(
		page
			.getByRole("group", { name: "Column In Progress" })
			.getByRole("button", { name: "To Do", exact: true }),
	).toBeVisible();
});

test("an assignee filter with no matching issues can be cleared", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(
			`/secure/RapidBoard.jspa?rapidView=${rapidViewId}&assignee=ghost`,
		)}`,
	);
	const clear = page.getByRole("button", { name: "Clear", exact: true });
	await expect(clear).toBeVisible();
	await clear.click();
	await expect(page).not.toHaveURL(/assignee=/);
});
