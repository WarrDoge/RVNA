import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const projectKey = `SD${run.slice(0, 4).toUpperCase()}`;
const projectName = `E2E Desk ${run}`;
const requestTypeName = `E2E Request ${run}`;
const queueName = `E2E Queue ${run}`;

let client: Client;
let projectId: string;
let deskId: string;
let requestTypeId: string;
let queueId: string;
let issueTypeId: string;
let workflowId: string;
const statusIds: string[] = [];

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const type = await client.query<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, $2, false) returning id`,
		[`e2e:${run}:issue-type`, requestTypeName],
	);
	issueTypeId = type.rows[0].id;

	const statuses = await client.query<{ id: string }>(
		`insert into statuses (source_id, name, category)
		 values ($1, $2, 'new'), ($3, $4, 'done') returning id`,
		[
			`e2e:${run}:status:open`,
			`E2E Open ${run}`,
			`e2e:${run}:status:done`,
			`E2E Done ${run}`,
		],
	);
	statusIds.push(...statuses.rows.map((row) => row.id));

	const workflow = await client.query<{ id: string }>(
		`insert into workflows (source_id, name) values ($1, $2) returning id`,
		[`e2e:${run}:workflow`, `E2E Workflow ${run}`],
	);
	workflowId = workflow.rows[0].id;
	for (const statusId of statusIds) {
		await client.query(
			`insert into workflow_statuses (source_id, workflow_id, status_id)
			 values ($1, $2, $3)`,
			[`e2e:${run}:workflow-status:${statusId}`, workflowId, statusId],
		);
	}

	const project = await client.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'service_desk', 0) returning id`,
		[`e2e:${run}:project`, projectKey, projectName],
	);
	projectId = project.rows[0].id;

	await client.query(
		`insert into project_issue_types (source_id, project_id, issue_type_id)
		 values ($1, $2, $3)`,
		[`e2e:${run}:project-type`, projectId, issueTypeId],
	);
	await client.query(
		`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, null, $3)`,
		[`e2e:${run}:project-workflow`, projectId, workflowId],
	);

	const desk = await client.query<{ id: string }>(
		`insert into service_desks (source_id, project_id, portal_name, description)
		 values ($1, $2, $3, $4) returning id`,
		[
			`e2e:${run}:desk`,
			projectId,
			`E2E Portal ${run}`,
			"Welcome to the end-to-end desk",
		],
	);
	deskId = desk.rows[0].id;

	const group = await client.query<{ id: string }>(
		`insert into request_type_groups (source_id, desk_id, name, sequence)
		 values ($1, $2, $3, 0) returning id`,
		[`e2e:${run}:group`, deskId, "E2E Group"],
	);

	const requestType = await client.query<{ id: string }>(
		`insert into request_types (source_id, desk_id, issue_type_id, name, description, sequence)
		 values ($1, $2, $3, $4, $5, 0) returning id`,
		[
			`e2e:${run}:request-type`,
			deskId,
			issueTypeId,
			requestTypeName,
			"Ask the end-to-end desk for help",
		],
	);
	requestTypeId = requestType.rows[0].id;

	await client.query(
		`insert into request_type_group_members (request_type_id, group_id, sequence)
		 values ($1, $2, 0)`,
		[requestTypeId, group.rows[0].id],
	);
	await client.query(
		`insert into request_type_fields (request_type_id, field_id, label, required, sequence)
		 values ($1, 'summary', 'Summary', true, 0), ($1, 'description', 'Details', false, 1)`,
		[requestTypeId],
	);

	const queue = await client.query<{ id: string }>(
		`insert into queues (source_id, desk_id, name, jql, columns, issue_count, sequence)
		 values ($1, $2, $3, $4, $5::jsonb, 0, 0) returning id`,
		[
			`e2e:${run}:queue`,
			deskId,
			queueName,
			`project = ${projectKey} AND resolution = Unresolved`,
			JSON.stringify(["issuekey", "summary"]),
		],
	);
	queueId = queue.rows[0].id;
});

test.afterAll(async () => {
	await client.query("delete from projects where id = $1", [projectId]);
	await client.query("delete from workflows where id = $1", [workflowId]);
	await client.query("delete from statuses where id = any($1::uuid[])", [
		statusIds,
	]);
	await client.query("delete from issue_types where id = $1", [issueTypeId]);
	await client.end();
});

test("raise a request, see it in the queue and keep internal notes off the portal", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/");

	await page.goto("/servicedesk/customer/portals");
	await expect(page).toHaveURL(/\/servicedesk\/customer\/portal\/[0-9a-f-]+$/);

	await page.goto(`/servicedesk/customer/portal/${deskId}`);
	await expect(
		page.getByRole("heading", { name: `E2E Portal ${run}` }),
	).toBeVisible();

	await page.getByRole("link", { name: requestTypeName }).click();
	await expect(page).toHaveURL(
		new RegExp(
			`/servicedesk/customer/portal/${deskId}/create/${requestTypeId}$`,
		),
	);
	await page.getByLabel("Summary").fill("Printer on the third floor is broken");
	await page
		.locator("[contenteditable='true']")
		.first()
		.fill("The printer shows a paper jam that will not clear.");
	await page.getByRole("button", { name: "Send" }).click();

	await expect(page).toHaveURL(
		new RegExp(`/servicedesk/customer/portal/${deskId}/${projectKey}-\\d+$`),
	);
	const key = page.url().split("/").pop() as string;
	await expect(
		page.getByRole("heading", { name: "Printer on the third floor is broken" }),
	).toBeVisible();

	await page.goto(`/projects/${projectKey}/queues/custom/${queueId}`);
	await expect(page.getByRole("heading", { name: queueName })).toBeVisible();
	await expect(
		page.getByRole("cell", { name: "Printer on the third floor is broken" }),
	).toBeVisible();

	await page.getByRole("link", { name: key }).click();
	await expect(page).toHaveURL(new RegExp(`/browse/${key}$`));
	await expect(
		page.getByRole("heading", { name: "Printer on the third floor is broken" }),
	).toBeVisible();

	const editor = page.locator("#activity-comment [contenteditable='true']");
	const addComment = page
		.locator("#activity-comment")
		.getByRole("button", { name: "Add comment", exact: true });
	await page.getByRole("tab", { name: "Comment internally" }).click();
	await editor.fill("Internal note: the fuser unit needs replacing.");
	await expect(addComment).toBeEnabled();
	await addComment.click();
	await expect(
		page.getByText("Internal note: the fuser unit needs replacing."),
	).toBeVisible();
	await expect(page.getByText("Internal", { exact: true })).toBeVisible();

	await page.getByRole("tab", { name: "Share with customer" }).click();
	await editor.fill("A technician will look at it this afternoon.");
	await expect(addComment).toBeEnabled();
	const posted = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			response.url().endsWith(`/api/issues/${key}/comments`),
	);
	await addComment.click();
	expect((await posted).status()).toBe(201);
	await expect(
		page.getByText("A technician will look at it this afternoon."),
	).toHaveCount(1);

	await page.goto(`/servicedesk/customer/portal/${deskId}/${key}`);
	await expect(
		page.getByText("A technician will look at it this afternoon."),
	).toBeVisible();
	await expect(
		page.getByText("Internal note: the fuser unit needs replacing."),
	).toHaveCount(0);
});
