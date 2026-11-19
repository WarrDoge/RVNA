import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const tag = `e2egl${run}`;
const projectKey = `EG${run.slice(0, 5).toUpperCase()}`;
const projectName = `E2E GitLab ${run}`;
const issueKey = `${projectKey}-1`;
const quietIssueKey = `${projectKey}-2`;
const secretKey = `${tag}:push`;

let client: Client;
let projectId: string;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const type = await client.query<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, $2, false) returning id`,
		[`${tag}:type`, `${tag} Task`],
	);
	const statuses = await client.query<{ id: string }>(
		`insert into statuses (source_id, name, category) values
		 ($1, $2, 'new'), ($3, $4, 'indeterminate'), ($5, $6, 'done')
		 returning id`,
		[
			`${tag}:status:todo`,
			`${tag} To Do`,
			`${tag}:status:progress`,
			`${tag} In Progress`,
			`${tag}:status:done`,
			`${tag} Done`,
		],
	);
	const workflow = await client.query<{ id: string }>(
		`insert into workflows (source_id, name) values ($1, $2) returning id`,
		[`${tag}:workflow`, `${tag} workflow`],
	);
	for (const status of statuses.rows) {
		await client.query(
			`insert into workflow_statuses (source_id, workflow_id, status_id)
			 values ($1, $2, $3)`,
			[`${tag}:ws:${status.id}`, workflow.rows[0].id, status.id],
		);
	}
	await client.query(
		`insert into workflow_transitions
		 (source_id, workflow_id, name, from_status_id, to_status_id, sequence)
		 values ($1, $2, 'Start progress', $3, $4, 0)`,
		[
			`${tag}:transition`,
			workflow.rows[0].id,
			statuses.rows[0].id,
			statuses.rows[1].id,
		],
	);

	const project = await client.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'software', 1) returning id`,
		[`${tag}:project`, projectKey, projectName],
	);
	projectId = project.rows[0].id;
	await client.query(
		`insert into project_issue_types (source_id, project_id, issue_type_id)
		 values ($1, $2, $3)`,
		[`${tag}:project-type`, projectId, type.rows[0].id],
	);
	await client.query(
		`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, null, $3)`,
		[`${tag}:project-workflow`, projectId, workflow.rows[0].id],
	);

	await client.query(
		`insert into issues
		 (source_id, project_id, number, key, type_id, status_id, summary, created, updated)
		 values ($1, $2, 1, $3, $4, $5, $6, now(), now()) returning id`,
		[
			`${tag}:issue`,
			projectId,
			issueKey,
			type.rows[0].id,
			statuses.rows[0].id,
			"GitLab development panel",
		],
	);

	await client.query(
		`insert into issues
		 (source_id, project_id, number, key, type_id, status_id, summary, created, updated)
		 values ($1, $2, 2, $3, $4, $5, $6, now(), now())`,
		[
			`${tag}:issue:2`,
			projectId,
			quietIssueKey,
			type.rows[0].id,
			statuses.rows[0].id,
			"No development yet",
		],
	);

	const repository = await client.query<{ id: string }>(
		`insert into gitlab_repositories (gitlab_project_id, path, name, web_url)
		 values ($1, $2, 'service', $3) returning id`,
		[
			900000 + Number.parseInt(run.slice(0, 4), 36),
			`${tag}/service`,
			`https://gitlab.example.test/${tag}/service`,
		],
	);
	await client.query(
		`insert into gitlab_project_repositories (project_id, repository_id)
		 values ($1, $2)`,
		[projectId, repository.rows[0].id],
	);
	await client.query(
		`insert into gitlab_project_settings (project_id, default_repository_id)
		 values ($1, $2)`,
		[projectId, repository.rows[0].id],
	);
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from projects where id = $1", [projectId]);
	await client.query("delete from gitlab_repositories where path like $1", [
		`${tag}/%`,
	]);
	await client.query(
		"delete from gitlab_deliveries where idempotency_key like $1",
		[`${tag}%`],
	);
	await client.query("delete from workflows where source_id like $1", [
		`${tag}%`,
	]);
	await client.query("delete from statuses where source_id like $1", [
		`${tag}%`,
	]);
	await client.query("delete from issue_types where source_id like $1", [
		`${tag}%`,
	]);
	await client.query(
		"update gitlab_config set base_url = '', webhook_secret = null, access_token = null",
	);
	await client.end();
});

test("an admin configures GitLab and the issue shows development activity", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/secure/Dashboard.jspa");
	await page.getByRole("button", { name: "Administration" }).click();
	await page.getByRole("menuitem", { name: "GitLab" }).click();
	await expect(page).toHaveURL(/\/plugins\/servlet\/gitlab$/);
	await expect(
		page.getByRole("heading", { name: "GitLab integration" }),
	).toBeVisible();

	const connection = page
		.getByLabel("Base URL")
		.locator("xpath=ancestor::section[1]");
	await page.getByLabel("Base URL").fill("https://gitlab.example.test");
	await connection.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByText("Saved")).toBeVisible();

	await page
		.getByRole("button", { name: /Generate secret|Replace secret/ })
		.click();
	const secretDialog = page.getByRole("dialog");
	await expect(secretDialog).toBeVisible();
	const secret = await secretDialog.getByLabel("Webhook secret").inputValue();
	expect(secret.length).toBeGreaterThan(20);
	await secretDialog.getByRole("button", { name: "Done" }).click();

	const project = {
		id: 910000 + Number.parseInt(run.slice(0, 4), 36),
		path_with_namespace: `${tag}/service`,
		name: "service",
		web_url: `https://gitlab.example.test/${tag}/service`,
	};
	const branch = `${issueKey}-panel`;
	const commitSha = "a".repeat(40);

	const push = await page.request.post("/api/integrations/gitlab/webhook", {
		headers: {
			"x-gitlab-token": secret,
			"x-gitlab-event": "Push Hook",
			"idempotency-key": secretKey,
		},
		data: {
			object_kind: "push",
			ref: `refs/heads/${branch}`,
			checkout_sha: commitSha,
			project,
			commits: [
				{
					id: commitSha,
					title: `${issueKey} show development activity`,
					message: `${issueKey} show development activity`,
					timestamp: "2026-05-01T10:00:00+00:00",
					url: `${project.web_url}/-/commit/${commitSha}`,
					author: {
						name: "GitLab Tester",
						email: "e2e-gitlab@example.test",
					},
				},
			],
			total_commits_count: 1,
		},
	});
	expect(push.status()).toBe(202);

	const mergeRequest = await page.request.post(
		"/api/integrations/gitlab/webhook",
		{
			headers: {
				"x-gitlab-token": secret,
				"x-gitlab-event": "Merge Request Hook",
				"idempotency-key": `${tag}:mr`,
			},
			data: {
				object_kind: "merge_request",
				project,
				user: {
					id: 1,
					name: "GitLab Tester",
					username: "gl-tester",
					email: "e2e-gitlab@example.test",
				},
				object_attributes: {
					iid: 5,
					title: `${issueKey} open a merge request`,
					state: "opened",
					action: "open",
					source_branch: branch,
					target_branch: "main",
					url: `${project.web_url}/-/merge_requests/5`,
					updated_at: "2026-05-02T10:00:00Z",
					author: {
						id: 1,
						name: "GitLab Tester",
						username: "gl-tester",
						email: "e2e-gitlab@example.test",
					},
				},
				reviewers: [],
			},
		},
	);
	expect(mergeRequest.status()).toBe(202);

	const deadline = Date.now() + 20_000;
	for (;;) {
		const rows = await client.query<{ status: string }>(
			`select status from gitlab_deliveries
			 where idempotency_key = any($1)`,
			[[secretKey, `${tag}:mr`]],
		);
		if (
			rows.rows.length === 2 &&
			rows.rows.every((row) => row.status === "processed")
		) {
			break;
		}
		if (Date.now() > deadline)
			throw new Error("Webhook deliveries did not run");
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	await page.goto(`/browse/${issueKey}`);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"GitLab development panel",
	);

	const development = page.locator("section").filter({
		has: page.getByRole("heading", { name: "Development", exact: true }),
	});
	await expect(development).toBeVisible({ timeout: 15_000 });
	await expect(
		development.getByRole("button", { name: "1 branch" }),
	).toBeVisible();
	await expect(
		development.getByRole("button", { name: "1 commit" }),
	).toBeVisible();
	await expect(
		development.getByRole("button", { name: /1 merge request/ }),
	).toBeVisible();
	await expect(development.getByText("OPEN", { exact: true })).toBeVisible();
	await expect(development.getByText(/Latest commit/)).toBeVisible();
	await expect(
		development.getByRole("link", { name: "Create branch" }),
	).toHaveAttribute(
		"href",
		`https://gitlab.example.test/${tag}/service/-/branches/new?branch_name=${issueKey}-gitlab-development-panel`,
	);

	await development.getByRole("button", { name: "1 branch" }).click();
	let dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("cell", { name: branch })).toBeVisible();
	await expect(dialog.getByRole("link", { name: branch })).toHaveAttribute(
		"target",
		"_blank",
	);
	await expect(dialog.getByRole("link", { name: branch })).toHaveAttribute(
		"rel",
		"noopener noreferrer",
	);
	await dialog.getByRole("button", { name: "Close" }).last().click();

	await development.getByRole("button", { name: "1 commit" }).click();
	dialog = page.getByRole("dialog");
	await expect(
		dialog.getByRole("cell", { name: `${issueKey} show development activity` }),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Close" }).last().click();

	await development.getByRole("button", { name: /1 merge request/ }).click();
	dialog = page.getByRole("dialog");
	await expect(
		dialog.getByRole("cell", { name: `${issueKey} open a merge request` }),
	).toBeVisible();
	await expect(dialog.getByText("OPEN", { exact: true })).toBeVisible();
	await dialog.getByRole("button", { name: "Close" }).last().click();
});

test("hides the Development panel when there is no activity", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/secure/Dashboard.jspa");
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await page.goto(`/browse/${quietIssueKey}`);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"No development yet",
	);
	await expect(
		page.getByRole("heading", { name: "Development", exact: true }),
	).toHaveCount(0);
});
