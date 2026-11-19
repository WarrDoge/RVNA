import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const projectKey = `E2E${run.slice(0, 4).toUpperCase()}`;
const projectName = `E2E ${run}`;
const workflowName = `E2E Workflow ${run}`;
const seededSummary = "E2E seeded issue";
const attachmentsDir = process.env.ATTACHMENTS_DIR ?? "./data/attachments";

const globalTables = [
	"issue_types",
	"priorities",
	"resolutions",
	"statuses",
] as const;
type GlobalTable = (typeof globalTables)[number];

let client: Client;
let projectId: string;
let workflowId: string;
const inserted: Record<GlobalTable, string[]> = {
	issue_types: [],
	priorities: [],
	resolutions: [],
	statuses: [],
};

// Every spec owns the rows it seeds: reusing a global row by name would let
// this spec's issues point at rows another spec removes in its teardown.
async function ensureGlobal(
	table: GlobalTable,
	name: string,
	values: Record<string, string | number> = {},
): Promise<string> {
	const columns = ["source_id", "name", ...Object.keys(values)];
	const params = [
		`e2e:${run}:${table}:${name}`,
		name,
		...Object.values(values),
	];
	const created = await client.query<{ id: string }>(
		`insert into ${table} (${columns.join(", ")})
		 values (${params.map((_, index) => `$${index + 1}`).join(", ")})
		 returning id`,
		params,
	);
	inserted[table].push(created.rows[0].id);
	return created.rows[0].id;
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const taskTypeId = await ensureGlobal("issue_types", "Task");
	const mediumPriorityId = await ensureGlobal("priorities", "Medium", {
		sequence: 2,
	});
	await ensureGlobal("priorities", "High", { sequence: 1 });
	await ensureGlobal("resolutions", "Done");

	const todoStatusId = await ensureGlobal("statuses", "To Do", {
		category: "new",
	});
	const inProgressStatusId = await ensureGlobal("statuses", "In Progress", {
		category: "indeterminate",
	});
	const doneStatusId = await ensureGlobal("statuses", "Done", {
		category: "done",
	});

	const workflow = await client.query<{ id: string }>(
		"insert into workflows (source_id, name) values ($1, $2) returning id",
		[`e2e:${run}:workflow`, workflowName],
	);
	workflowId = workflow.rows[0].id;

	const workflowStatuses = [todoStatusId, inProgressStatusId, doneStatusId];
	for (const [index, statusId] of workflowStatuses.entries()) {
		await client.query(
			`insert into workflow_statuses (source_id, workflow_id, status_id)
			 values ($1, $2, $3)`,
			[`e2e:${run}:workflow-status:${index}`, workflowId, statusId],
		);
	}

	const transitions = [
		{ name: "Start progress", from: todoStatusId, to: inProgressStatusId },
		{ name: "Done", from: todoStatusId, to: doneStatusId },
	];
	for (const [index, transition] of transitions.entries()) {
		await client.query(
			`insert into workflow_transitions
			 (source_id, workflow_id, name, from_status_id, to_status_id, sequence)
			 values ($1, $2, $3, $4, $5, $6)`,
			[
				`e2e:${run}:transition:${index}`,
				workflowId,
				transition.name,
				transition.from,
				transition.to,
				index,
			],
		);
	}

	const project = await client.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'software', 1) returning id`,
		[`e2e:${run}`, projectKey, projectName],
	);
	projectId = project.rows[0].id;

	await client.query(
		`insert into project_issue_types (source_id, project_id, issue_type_id)
		 values ($1, $2, $3)`,
		[`e2e:${run}:project-type`, projectId, taskTypeId],
	);
	await client.query(
		`insert into project_workflows
		 (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, $3, $4)`,
		[`e2e:${run}:project-workflow`, projectId, taskTypeId, workflowId],
	);

	const issue = await client.query<{ id: string }>(
		`insert into issues
		 (source_id, project_id, number, key, type_id, status_id, priority_id,
		  summary, description_html, description_source, created, updated)
		 values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, now(), now())
		 returning id`,
		[
			`e2e:${run}:issue`,
			projectId,
			`${projectKey}-1`,
			taskTypeId,
			todoStatusId,
			mediumPriorityId,
			seededSummary,
			"<p>E2E seeded description</p>",
			"E2E seeded description",
		],
	);
	const issueId = issue.rows[0].id;

	await client.query(
		`insert into comments (source_id, issue_id, body_html, body_source, created, updated)
		 values ($1, $2, $3, $4, now(), now())`,
		[
			`e2e:${run}:comment`,
			issueId,
			"<p>E2E seeded comment</p>",
			"E2E seeded comment",
		],
	);

	const history = await client.query<{ id: string }>(
		`insert into issue_history (source_id, issue_id, created)
		 values ($1, $2, now()) returning id`,
		[`e2e:${run}:history`, issueId],
	);
	await client.query(
		`insert into issue_history_items
		 (source_id, history_id, field, field_type, to_string, sequence)
		 values ($1, $2, 'description', 'jira', $3, 0)`,
		[`e2e:${run}:history-item`, history.rows[0].id, "E2E seeded description"],
	);
});

test.afterAll(async () => {
	if (!client) return;
	const files = await client.query<{ storage_path: string }>(
		`select a.storage_path from attachments a
		 join issues i on i.id = a.issue_id
		 where i.project_id = $1`,
		[projectId],
	);
	await client.query("delete from issues where project_id = $1", [projectId]);
	await client.query("delete from projects where id = $1", [projectId]);
	await client.query("delete from workflows where id = $1", [workflowId]);
	// A transition in another spec may have picked this spec's "Done" resolution
	// or priority by name; both references are nullable, so detach them.
	await client.query(
		"update issues set resolution_id = null where resolution_id = any($1::uuid[])",
		[inserted.resolutions],
	);
	await client.query(
		"update issues set priority_id = null where priority_id = any($1::uuid[])",
		[inserted.priorities],
	);
	for (const table of globalTables) {
		await client.query(`delete from ${table} where id = any($1::uuid[])`, [
			inserted[table],
		]);
	}
	for (const file of files.rows) {
		await unlink(join(attachmentsDir, file.storage_path)).catch(
			() => undefined,
		);
	}
	await client.end();
});

test("browse a seeded issue, then create, edit, comment, transition and attach", async ({
	page,
}) => {
	const iconRequests: string[] = [];
	page.on("request", (request) => {
		if (/\/api\/avatars\/(issuetypes|priorities)\//.test(request.url())) {
			iconRequests.push(request.url());
		}
	});

	await page.goto("/auth/login?returnTo=/secure/BrowseProjects.jspa");
	await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

	await page.getByRole("link", { name: projectName }).click();
	await expect(page).toHaveURL(new RegExp(`/projects/${projectKey}/issues$`));
	await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();

	const firstRow = page.locator("tbody tr").first();
	const seededKey = await firstRow.locator("td").nth(1).textContent();
	await firstRow.getByRole("link").first().click();
	await expect(page).toHaveURL(new RegExp(`/browse/${seededKey}$`));
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		seededSummary,
	);
	await expect(page.getByTestId("issue-status")).toBeVisible();
	await expect(
		page.getByRole("tab", { name: /^Comments \(1\)$/ }),
	).toBeVisible();
	await expect(
		page.getByRole("tab", { name: /^History \(1\)$/ }),
	).toBeVisible();
	await expect(page.getByText("E2E seeded comment")).toBeVisible();
	await expect(page.getByText(/changed the description/).first()).toBeVisible();
	expect(iconRequests).toEqual([]);

	const activityTabs = page.getByRole("tablist", { name: "Issue activity" });
	await expect(activityTabs.getByRole("tab")).toHaveCount(4);
	await expect(activityTabs.getByRole("tab", { name: /^All/ })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		activityTabs.getByRole("tab", { name: /^Comments/ }),
	).toHaveAttribute("aria-selected", "false");

	await page.goto("/secure/BrowseProjects.jspa");
	await page.getByRole("link", { name: projectName }).click();
	await expect(page).toHaveURL(new RegExp(`/projects/${projectKey}/issues$`));

	await page.getByRole("button", { name: "Create", exact: true }).click();
	const createDialog = page.getByRole("dialog");
	await expect(createDialog).toBeVisible();
	await createDialog.getByLabel("Project").selectOption(projectKey);
	await expect(
		createDialog.getByLabel("Issue Type", { exact: true }),
	).not.toHaveValue("");
	await createDialog.getByLabel("Summary").fill("E2E created issue");
	await createDialog
		.getByRole("button", { name: "Create", exact: true })
		.click();
	await expect(createDialog).toBeHidden();

	const flag = page.getByRole("status");
	await expect(flag).toBeVisible();
	const flagLink = flag.getByRole("link");
	await expect(flagLink).toHaveText(new RegExp(`^${projectKey}-\\d+$`));
	const createdKey = await flagLink.textContent();
	await flagLink.click();
	await expect(page).toHaveURL(new RegExp(`/browse/${createdKey}$`));
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"E2E created issue",
	);

	await page.getByRole("heading", { level: 1 }).click();
	await page.getByLabel("Summary").fill("E2E edited issue");
	await page.getByLabel("Summary").press("Enter");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"E2E edited issue",
	);

	await page.getByRole("button", { name: "More" }).click();
	await page.getByRole("menuitem", { name: "Clone" }).click();
	const cloneDialog = page.getByRole("dialog");
	await expect(cloneDialog).toBeVisible();
	await expect(cloneDialog.getByLabel("Summary")).toHaveValue(
		"CLONE - E2E edited issue",
	);
	await cloneDialog.getByLabel("Summary").fill("E2E cloned issue");
	await cloneDialog
		.getByRole("button", { name: "Create", exact: true })
		.click();
	await expect(cloneDialog).toBeHidden();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"E2E cloned issue",
	);

	await page
		.getByRole("button", { name: "Add comment", exact: true })
		.first()
		.click();
	const commentEditor = page.locator(
		"#activity-comment [contenteditable='true']",
	);
	await commentEditor.fill("E2E comment body");
	await page
		.getByRole("button", { name: "Add comment", exact: true })
		.last()
		.click();
	await expect(page.getByText("E2E comment body")).toBeVisible();

	await page.getByRole("button", { name: "Done", exact: true }).click();
	await expect(page.getByTestId("issue-status")).toContainText(/done/i);
	await expect(page.getByTestId("issue-resolution")).toContainText("Done");

	await page.getByLabel("Attach files").setInputFiles({
		name: "note.bin",
		mimeType: "application/octet-stream",
		buffer: Buffer.from("e2e attachment"),
	});
	await expect(page.getByRole("link", { name: "note.bin" })).toBeVisible();

	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("link", { name: "note.bin" }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe("note.bin");
	const path = await download.path();
	expect(path).not.toBeNull();
	expect(await readFile(path as string, "utf8")).toBe("e2e attachment");
});
