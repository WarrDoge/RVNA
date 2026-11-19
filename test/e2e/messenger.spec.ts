import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { FakeMatrix } from "../helpers/fake-matrix.ts";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const tag = `e2emx${run}`;
const projectKey = `MX${run.slice(0, 5).toUpperCase()}`;
const projectName = `E2E Messenger ${run}`;
const requestTypeName = `E2E Chat request ${run}`;

let client: Client;
let fake: FakeMatrix;
let projectId: string;
let deskId: string;
let requestTypeId: string;
let issueTypeId: string;
let workflowId: string;
let statusIds: string[] = [];

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const type = await client.query<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, $2, false) returning id`,
		[`${tag}:type`, `${tag} Request`],
	);
	issueTypeId = type.rows[0].id;
	const statuses = await client.query<{ id: string }>(
		`insert into statuses (source_id, name, category)
		 values ($1, $2, 'new'), ($3, $4, 'done') returning id`,
		[`${tag}:status:open`, `${tag} Open`, `${tag}:status:done`, `${tag} Done`],
	);
	statusIds = statuses.rows.map((row) => row.id);
	const workflow = await client.query<{ id: string }>(
		`insert into workflows (source_id, name) values ($1, $2) returning id`,
		[`${tag}:workflow`, `${tag} Workflow`],
	);
	workflowId = workflow.rows[0].id;
	for (const statusId of statusIds) {
		await client.query(
			`insert into workflow_statuses (source_id, workflow_id, status_id)
			 values ($1, $2, $3)`,
			[`${tag}:workflow-status:${statusId}`, workflowId, statusId],
		);
	}
	const project = await client.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'service_desk', 0) returning id`,
		[`${tag}:project`, projectKey, projectName],
	);
	projectId = project.rows[0].id;
	await client.query(
		`insert into project_issue_types (source_id, project_id, issue_type_id)
		 values ($1, $2, $3)`,
		[`${tag}:project-type`, projectId, issueTypeId],
	);
	await client.query(
		`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, null, $3)`,
		[`${tag}:project-workflow`, projectId, workflowId],
	);
	const desk = await client.query<{ id: string }>(
		`insert into service_desks (source_id, project_id, portal_name, open_access)
		 values ($1, $2, $3, true) returning id`,
		[`${tag}:desk`, projectId, `E2E Messenger portal ${run}`],
	);
	deskId = desk.rows[0].id;
	const requestType = await client.query<{ id: string }>(
		`insert into request_types (source_id, desk_id, issue_type_id, name, sequence)
		 values ($1, $2, $3, $4, 0) returning id`,
		[`${tag}:request-type`, deskId, issueTypeId, requestTypeName],
	);
	requestTypeId = requestType.rows[0].id;
	await client.query(
		`insert into request_type_fields (request_type_id, field_id, label, required, sequence)
		 values ($1, 'summary', 'Summary', true, 0), ($1, 'description', 'Details', false, 1)`,
		[requestTypeId],
	);

	fake = await new FakeMatrix({ port: 5176 }).start();
});

test.afterAll(async () => {
	await fake.close();
	if (projectId) {
		await client.query("delete from projects where id = $1", [projectId]);
	}
	if (workflowId) {
		await client.query("delete from workflows where id = $1", [workflowId]);
	}
	if (statusIds.length > 0) {
		await client.query("delete from statuses where id = any($1::uuid[])", [
			statusIds,
		]);
	}
	if (issueTypeId) {
		await client.query("delete from issue_types where id = $1", [issueTypeId]);
	}
	await client.query("delete from messenger_config");
	await client.end();
});

test("administrator connects the bot and a profile links a Matrix id", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/plugins/servlet/messenger");
	await expect(page.getByRole("heading", { name: "Messenger" })).toBeVisible();

	await page.getByLabel("Homeserver URL").fill(fake.url);
	await page.getByLabel("Bot access token").fill(fake.token);
	await page.getByRole("button", { name: "Save token" }).click();
	await expect(page.getByText("Set", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByText("Saved")).toBeVisible();

	await page.getByRole("button", { name: "Test connection" }).click();
	await expect(page.getByText(`Connected as ${fake.botUserId}`)).toBeVisible();

	await page.getByLabel("Service desk").selectOption(deskId);
	await page.getByLabel("Request type").selectOption(requestTypeId);
	await page.getByLabel("Enabled").check();
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByText("Saved")).toBeVisible();
	await page.waitForTimeout(500);
	await page.reload();
	await expect(page.getByText("Running", { exact: true })).toBeVisible();
	await expect(page.getByText(`Invite ${fake.botUserId}`)).toBeVisible();

	await page.goto("/secure/ViewProfile.jspa");
	await expect(page.getByRole("heading", { name: "dev" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Messenger" })).toBeVisible();
	await expect(page.getByText("Not connected")).toBeVisible();
	await page.getByRole("button", { name: "Connect to messenger" }).click();
	const instruction = page.getByText(/Send !link [A-Z0-9]+ to/);
	await expect(instruction).toBeVisible();
	const code = (await instruction.textContent())?.match(
		/!link ([A-Z0-9]+)/,
	)?.[1];
	expect(code).toBeTruthy();

	const roomId = `!e2e-${run}:matrix.test`;
	fake.pushInvite(roomId);
	await fake.waitFor(() => fake.joins.includes(roomId));
	fake.pushJoinedTimeline(roomId, [
		{
			type: "m.room.message",
			event_id: `$e2e-link-${run}`,
			sender: "@dev:matrix.test",
			content: { msgtype: "m.text", body: `!link ${code}` },
		},
	]);
	await fake.waitFor(() =>
		fake.sent.some((item) =>
			String(item.content.body ?? "").includes("Connected @dev:matrix.test"),
		),
	);
	await page.reload();
	await expect(page.getByText("Connected as @dev:matrix.test")).toBeVisible();
	await page.screenshot({
		path: "test-results/messenger-profile.png",
		fullPage: true,
	});

	await page.goto("/plugins/servlet/messenger");
	await page.getByLabel("Enabled").uncheck();
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
	await page.screenshot({
		path: "test-results/messenger-admin.png",
		fullPage: true,
	});
});
