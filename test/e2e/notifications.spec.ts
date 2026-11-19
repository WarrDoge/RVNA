import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, withHydrationWait } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const projectKey = `NT${run.slice(0, 4).toUpperCase()}`;
const issueSummary = `E2E mention ${run}`;
const displayName = `E2E-B-${run}`;

let client: Client;
let projectId: string;
let issueKey: string;
let mentionedUserId: string;
let sessionId: string;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const type = await client.query<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, $2, false) returning id`,
		[`e2e:${run}:type`, `E2E ${run} Task`],
	);
	const status = await client.query<{ id: string }>(
		`insert into statuses (source_id, name, category)
		 values ($1, $2, 'new') returning id`,
		[`e2e:${run}:status`, `E2E ${run} To Do`],
	);
	const workflow = await client.query<{ id: string }>(
		`insert into workflows (source_id, name) values ($1, $2) returning id`,
		[`e2e:${run}:workflow`, `E2E ${run} workflow`],
	);
	await client.query(
		`insert into workflow_statuses (source_id, workflow_id, status_id)
		 values ($1, $2, $3)`,
		[`e2e:${run}:workflow-status`, workflow.rows[0].id, status.rows[0].id],
	);

	const project = await client.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'software', 0) returning id`,
		[`e2e:${run}`, projectKey, `E2E notifications ${run}`],
	);
	projectId = project.rows[0].id;
	await client.query(
		`insert into project_issue_types (source_id, project_id, issue_type_id)
		 values ($1, $2, $3)`,
		[`e2e:${run}:project-type`, projectId, type.rows[0].id],
	);
	await client.query(
		`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, null, $3)`,
		[`e2e:${run}:project-workflow`, projectId, workflow.rows[0].id],
	);

	const mentioned = await client.query<{ id: string }>(
		`insert into users (username, display_name, email)
		 values ($1, $2, $3) returning id`,
		[`t-${run}-b`, displayName, `t-${run}-b@example.test`],
	);
	mentionedUserId = mentioned.rows[0].id;

	sessionId = randomUUID().replaceAll("-", "");
	await client.query(
		`insert into sessions (id_hash, user_id, expires_at)
		 values ($1, $2, now() + interval '1 day')`,
		[createHash("sha256").update(sessionId).digest("hex"), mentionedUserId],
	);
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from notifications where issue_key like $1", [
		`${projectKey}-%`,
	]);
	await client.query("delete from email_batches where issue_key like $1", [
		`${projectKey}-%`,
	]);
	await client.query("delete from projects where id = $1", [projectId]);
	await client.query("delete from users where id = $1", [mentionedUserId]);
	await client.query("delete from workflows where source_id = $1", [
		`e2e:${run}:workflow`,
	]);
	await client.query("delete from issue_types where source_id = $1", [
		`e2e:${run}:type`,
	]);
	await client.query("delete from statuses where source_id = $1", [
		`e2e:${run}:status`,
	]);
	await client.end();
});

test("a mention reaches the mentioned user's bell and opens the issue", async ({
	page,
	browser,
}) => {
	await page.goto("/auth/login?returnTo=/secure/Dashboard.jspa");
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

	const created = await page.request.post("/api/issues", {
		headers: { "X-Requested-With": "rvna" },
		data: {
			project: projectKey,
			type: await typeId(),
			summary: issueSummary,
		},
	});
	expect(created.status()).toBe(201);
	issueKey = ((await created.json()) as { key: string }).key;

	await page.goto(`/browse/${issueKey}`);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		issueSummary,
	);

	const editor = page.locator("#activity-comment [contenteditable='true']");
	await editor.click();
	await page.keyboard.type("@");
	await expect(
		page.getByRole("listbox", { name: "Mention a user" }),
	).toBeVisible();
	await page.keyboard.type(`E2E-B-${run}`);
	const option = page.getByRole("option", { name: new RegExp(displayName) });
	await expect(option).toBeVisible();
	await option.click();
	await expect(editor.locator("a.user-hover")).toHaveText(`@${displayName}`);
	await expect(
		page.getByRole("listbox", { name: "Mention a user" }),
	).toBeHidden();

	await page
		.getByRole("button", { name: "Add comment", exact: true })
		.last()
		.click();
	await expect(page.getByText(`@${displayName}`).first()).toBeVisible();
	await expect
		.poll(async () => {
			const { rows } = await client.query(
				"select 1 from notifications where issue_key = $1",
				[issueKey],
			);
			return rows.length;
		})
		.toBeGreaterThan(0);

	const baseURL = test.info().project.use.baseURL as string;
	const context = await browser.newContext({ baseURL });
	await context.addCookies([
		{
			name: "sid",
			value: sessionId,
			url: baseURL,
			httpOnly: true,
			sameSite: "Lax",
		},
	]);
	const other = withHydrationWait(await context.newPage());
	await other.goto("/secure/Dashboard.jspa");

	const bell = other.getByRole("button", {
		name: /^Notifications, \d+ unread$/,
	});
	await expect(bell).toBeVisible();
	await bell.click();

	const item = other
		.getByRole("dialog", { name: "Notifications" })
		.getByRole("button", { name: new RegExp(issueKey) });
	await expect(item).toBeVisible();
	await expect(item).toContainText("mentioned you on");
	await expect(item).toContainText(issueSummary);

	await item.click();
	await expect(other).toHaveURL(new RegExp(`/browse/${issueKey}$`));
	await expect(other.getByRole("heading", { level: 1 })).toHaveText(
		issueSummary,
	);
	await expect(
		other.getByRole("button", { name: /^Notifications, \d+ unread$/ }),
	).toHaveCount(0);
	await expect(
		other.getByRole("button", { name: "Notifications", exact: true }),
	).toBeVisible();

	await context.close();
});

async function typeId() {
	const rows = await client.query<{ id: string }>(
		"select id from issue_types where source_id = $1",
		[`e2e:${run}:type`],
	);
	return rows.rows[0].id;
}
