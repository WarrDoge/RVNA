import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const tag = `e2e-reports-${run}`;
const projectKey = `RP${run.slice(0, 4).toUpperCase()}`;
const rapidViewId = 950000 + Number.parseInt(run.slice(0, 4), 16);
const sprintName = "Fixture closed sprint";

let client: Client;
let projectId: string;
let boardId: string;
let sprintId: string;
const issueKeys = {
	completed: `${projectKey}-1`,
	notCompleted: `${projectKey}-2`,
	removed: `${projectKey}-3`,
	added: `${projectKey}-4`,
};

async function query<T extends Record<string, unknown>>(
	text: string,
	values: unknown[] = [],
) {
	const result = await client.query<T>(text, values);
	return result.rows;
}

async function history(
	issueId: string,
	created: string,
	items: { field: string; from: string; to: string }[],
) {
	const [row] = await query<{ id: string }>(
		`insert into issue_history (source_id, issue_id, created)
		 values ($1, $2, $3) returning id`,
		[`${tag}:history:${randomUUID()}`, issueId, created],
	);
	for (const [sequence, item] of items.entries()) {
		await client.query(
			`insert into issue_history_items
				(source_id, history_id, field, from_string, to_string, sequence)
			 values ($1, $2, $3, $4, $5, $6)`,
			[
				`${tag}:item:${randomUUID()}`,
				row.id,
				item.field,
				item.from,
				item.to,
				sequence,
			],
		);
	}
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

	const projectRows = await query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'software', 4) returning id`,
		[`${tag}:project`, projectKey, `E2E reports ${run}`],
	);
	projectId = projectRows[0].id;

	const boardRows = await query<{ id: string }>(
		`insert into boards
			(rapid_view_id, source_id, name, type, filter_jql, project_id,
			 estimation_field, config_imported)
		 values ($1, $2, $3, 'scrum', $4, $5, 'story_points', true)
		 returning id`,
		[
			rapidViewId,
			`${tag}:board`,
			"E2E reports board",
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

	const sprintRows = await query<{ id: string }>(
		`insert into sprints
			(source_id, board_id, name, goal, state, start_date, end_date,
			 complete_date, sequence)
		 values ($1, $2, $3, 'Fixture goal', 'closed',
			'2026-01-05T09:00:00.000Z', '2026-01-16T18:00:00.000Z',
			'2026-01-16T19:00:00.000Z', 0)
		 returning id`,
		[`${tag}:sprint`, boardId, sprintName],
	);
	sprintId = sprintRows[0].id;

	const created = await query<{ id: string; key: string }>(
		`insert into issues
			(source_id, project_id, number, key, type_id, status_id, summary,
			 story_points, rank)
		 values
			($1, $5, 1, $6, $9, $10, 'Completed fixture issue', 5, '0|a'),
			($2, $5, 2, $7, $9, $11, 'Unfinished fixture issue', 3, '0|b'),
			($3, $5, 3, $8, $9, $11, 'Removed fixture issue', 2, '0|c'),
			($4, $5, 4, $12, $9, $10, 'Added fixture issue', 1, '0|d')
		 returning id, key`,
		[
			`${tag}:issue-1`,
			`${tag}:issue-2`,
			`${tag}:issue-3`,
			`${tag}:issue-4`,
			projectId,
			issueKeys.completed,
			issueKeys.notCompleted,
			issueKeys.removed,
			typeId,
			done,
			todo,
			issueKeys.added,
		],
	);
	const byKey = new Map(created.map((row) => [row.key, row.id]));

	for (const key of [
		issueKeys.completed,
		issueKeys.notCompleted,
		issueKeys.added,
	]) {
		await client.query(
			`insert into issue_sprints (issue_id, sprint_id, is_open)
			 values ($1, $2, false)`,
			[byKey.get(key), sprintId],
		);
	}

	await history(
		byKey.get(issueKeys.completed) as string,
		"2026-01-05T09:00:00.000Z",
		[{ field: "Sprint", from: "", to: sprintName }],
	);
	await history(
		byKey.get(issueKeys.completed) as string,
		"2026-01-10T12:00:00.000Z",
		[{ field: "status", from: "In Progress", to: "Done" }],
	);
	await history(
		byKey.get(issueKeys.notCompleted) as string,
		"2026-01-05T09:00:00.000Z",
		[{ field: "Sprint", from: "", to: sprintName }],
	);
	await history(
		byKey.get(issueKeys.removed) as string,
		"2026-01-05T09:00:00.000Z",
		[{ field: "Sprint", from: "", to: sprintName }],
	);
	await history(
		byKey.get(issueKeys.removed) as string,
		"2026-01-09T12:00:00.000Z",
		[{ field: "Sprint", from: sprintName, to: "" }],
	);
	await history(
		byKey.get(issueKeys.added) as string,
		"2026-01-07T12:00:00.000Z",
		[{ field: "Sprint", from: "", to: sprintName }],
	);
	await history(
		byKey.get(issueKeys.added) as string,
		"2026-01-12T12:00:00.000Z",
		[{ field: "status", from: "To Do", to: "Done" }],
	);
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from boards where id = $1", [boardId]);
	await client.query("delete from projects where id = $1", [projectId]);
	await client.query("delete from statuses where source_id like $1", [
		`${tag}%`,
	]);
	await client.query("delete from issue_types where source_id like $1", [
		`${tag}%`,
	]);
	await client.end();
});

test("open the burndown and sprint report of a closed sprint", async ({
	page,
}) => {
	const burndown = `/secure/RapidBoard.jspa?rapidView=${rapidViewId}&view=reporting&chart=burndownChart&sprint=${sprintId}`;
	await page.goto(`/auth/login?returnTo=${encodeURIComponent(burndown)}`);
	await expect(
		page.getByRole("heading", { name: "Burndown Chart" }),
	).toBeVisible();
	await expect(page.locator("svg[role='img']")).toBeVisible();
	await expect(page.getByText("Issue completed").first()).toBeVisible();
	await expect(
		page.getByRole("link", { name: issueKeys.completed }),
	).toBeVisible();

	const report = `/secure/RapidBoard.jspa?rapidView=${rapidViewId}&view=reporting&chart=sprintRetrospective&sprint=${sprintId}`;
	await page.goto(report);
	await expect(
		page.getByRole("heading", { name: "Sprint Report" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Completed issues" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: issueKeys.completed }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Issues not completed" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: issueKeys.notCompleted }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Issues removed from sprint" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: issueKeys.removed }),
	).toBeVisible();
	await expect(page.getByText("added after sprint start")).toBeVisible();
});

test("the cumulative flow filters are kept in the URL", async ({ page }) => {
	const url = `/secure/RapidBoard.jspa?rapidView=${rapidViewId}&view=reporting&chart=cumulativeFlowDiagram`;
	await page.goto(`/auth/login?returnTo=${encodeURIComponent(url)}`);
	await expect(
		page.getByRole("heading", { name: "Cumulative Flow Diagram" }),
	).toBeVisible();
	const from = page.getByLabel("From");
	const fromDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);
	await from.fill(fromDate);
	await from.dispatchEvent("change");
	await expect(page).toHaveURL(new RegExp(`from=${fromDate}`));
	const firstColumn = page.locator(".column-toggle input").first();
	await firstColumn.uncheck();
	await expect(page).toHaveURL(/hidden=/);
});
