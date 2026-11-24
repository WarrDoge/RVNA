import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const projectKey = `SU${run.slice(0, 4).toUpperCase()}`;
const requestTypeName = `Upload Request ${run}`;
const summary = `Upload retry ${run}`;

let client: Client;
let projectId: string;
let deskId: string;
let requestTypeId: string;
let issueTypeId: string;
let workflowId: string;
let statusId: string;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const type = await client.query<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, $2, false) returning id`,
		[`e2e:${run}:issue-type`, requestTypeName],
	);
	issueTypeId = type.rows[0].id;

	const status = await client.query<{ id: string }>(
		`insert into statuses (source_id, name, category)
		 values ($1, $2, 'new') returning id`,
		[`e2e:${run}:status:open`, `E2E Open ${run}`],
	);
	statusId = status.rows[0].id;

	const workflow = await client.query<{ id: string }>(
		`insert into workflows (source_id, name) values ($1, $2) returning id`,
		[`e2e:${run}:workflow`, `E2E Workflow ${run}`],
	);
	workflowId = workflow.rows[0].id;
	await client.query(
		`insert into workflow_statuses (source_id, workflow_id, status_id)
		 values ($1, $2, $3)`,
		[`e2e:${run}:workflow-status`, workflowId, statusId],
	);

	const project = await client.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'service_desk', 0) returning id`,
		[`e2e:${run}:project`, projectKey, `E2E Upload ${run}`],
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
		`insert into service_desks (source_id, project_id, portal_name)
		 values ($1, $2, $3) returning id`,
		[`e2e:${run}:desk`, projectId, `E2E Upload Portal ${run}`],
	);
	deskId = desk.rows[0].id;

	const requestType = await client.query<{ id: string }>(
		`insert into request_types (source_id, desk_id, issue_type_id, name, sequence)
		 values ($1, $2, $3, $4, 0) returning id`,
		[`e2e:${run}:request-type`, deskId, issueTypeId, requestTypeName],
	);
	requestTypeId = requestType.rows[0].id;

	await client.query(
		`insert into request_type_fields (request_type_id, field_id, label, required, sequence)
		 values ($1, 'summary', 'Summary', true, 0), ($1, 'attachment', 'Attachment', false, 1)`,
		[requestTypeId],
	);
});

test.afterAll(async () => {
	await client.query("delete from projects where id = $1", [projectId]);
	await client.query("delete from workflows where id = $1", [workflowId]);
	await client.query("delete from statuses where id = $1", [statusId]);
	await client.query("delete from issue_types where id = $1", [issueTypeId]);
	await client.end();
});

test("a failed attachment upload still opens the created request, once", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/");
	await page.goto(
		`/servicedesk/customer/portal/${deskId}/create/${requestTypeId}`,
	);
	await page.getByLabel("Summary").fill(summary);
	await page.locator("#portal-attachment").setInputFiles(
		Array.from({ length: 21 }, (_, number) => ({
			name: `log-${number}.txt`,
			mimeType: "text/plain",
			buffer: Buffer.from("printer log"),
		})),
	);
	await page.getByRole("button", { name: "Send" }).click();

	await expect(page).toHaveURL(
		new RegExp(
			`/servicedesk/customer/portal/${deskId}/${projectKey}-\\d+(\\?.*)?$`,
		),
	);
	await expect(page.getByRole("alert")).toBeVisible();

	const { rows } = await client.query<{ n: number }>(
		"select count(*)::int as n from issues where project_id = $1 and summary = $2",
		[projectId, summary],
	);
	expect(rows[0].n).toBe(1);
});
