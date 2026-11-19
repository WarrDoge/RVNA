import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const tag = run.toUpperCase();
const templateKey = `ET${tag.slice(0, 4)}`;
const projectKey = `EA${tag.slice(0, 4)}`;
const templateName = `E2E Template ${run}`;
const projectName = `E2E Admin ${run}`;
const typeName = `E2E Task ${run}`;
const todoName = `E2E To Do ${run}`;
const doneName = `E2E Done ${run}`;
const reviewName = `E2E In Review ${run}`;
const workflowName = `E2E Workflow ${run}`;
const copyName = `E2E Workflow copy ${run}`;
const fieldName = `E2E Stage ${run}`;
const startReview = `Start review ${run}`;
const approve = `Approve ${run}`;

let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const status = async (name: string, category: string) =>
		(
			await client.query<{ id: string }>(
				"insert into statuses (source_id, name, category) values ($1, $2, $3) returning id",
				[`e2e:${run}:${name}`, name, category],
			)
		).rows[0]?.id as string;
	const todo = await status(todoName, "new");
	const done = await status(doneName, "done");

	const type = (
		await client.query<{ id: string }>(
			"insert into issue_types (source_id, name, subtask) values ($1, $2, false) returning id",
			[`e2e:${run}:type`, typeName],
		)
	).rows[0]?.id as string;

	const workflow = (
		await client.query<{ id: string }>(
			"insert into workflows (name, initial_status_id) values ($1, $2) returning id",
			[workflowName, todo],
		)
	).rows[0]?.id as string;
	for (const statusId of [todo, done]) {
		await client.query(
			"insert into workflow_statuses (workflow_id, status_id) values ($1, $2)",
			[workflow, statusId],
		);
	}
	await client.query(
		`insert into workflow_transitions (workflow_id, name, from_status_id, to_status_id, sequence)
		 values ($1, $2, $3, $4, 1)`,
		[workflow, `Finish ${run}`, todo, done],
	);

	const template = (
		await client.query<{ id: string }>(
			`insert into projects (source_id, key, name, project_type, last_issue_number)
			 values ($1, $2, $3, 'software', 0) returning id`,
			[`e2e:${run}:template`, templateKey, templateName],
		)
	).rows[0]?.id as string;
	await client.query(
		`insert into project_issue_types (source_id, project_id, issue_type_id) values ($1, $2, $3)`,
		[`e2e:${run}:template-type`, template, type],
	);
	await client.query(
		`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, null, $3)`,
		[`e2e:${run}:template-workflow`, template, workflow],
	);
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from projects where key = any($1)", [
		[templateKey, projectKey],
	]);
	await client.query("delete from fields where name = $1", [fieldName]);
	await client.query("delete from workflows where name = any($1)", [
		[workflowName, copyName],
	]);
	await client.query("delete from statuses where name = any($1)", [
		[todoName, doneName, reviewName],
	]);
	await client.query("delete from issue_types where name = $1", [typeName]);
	await client.query("delete from users where username like $1", [
		`e2e-na-${run}%`,
	]);
	await client.query(
		"delete from audit_log where summary like $1 or actor_name like $1",
		[`%${run}%`],
	);
	await client.end();
});

test("admin builds a project, a custom field and a workflow, then works an issue through them", async ({
	page,
}) => {
	test.setTimeout(240_000);

	await page.goto("/auth/login?returnTo=/secure/project/ViewProjects.jspa");
	await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

	await page.getByRole("button", { name: "Create project" }).first().click();
	const createProject = page.getByRole("dialog");
	await createProject.getByLabel("Name").fill(projectName);
	await createProject.getByLabel("Key").fill(projectKey);
	await createProject.getByLabel("Template").selectOption(templateKey);
	await createProject
		.getByRole("button", { name: "Create", exact: true })
		.click();
	await expect(createProject).toBeHidden();
	await expect(
		page.getByRole("row", { name: new RegExp(projectKey) }),
	).toBeVisible();

	await page.goto("/secure/admin/ViewCustomFields.jspa");
	await page.getByRole("button", { name: "Add custom field" }).click();
	await page
		.getByRole("button", { name: /^Select List \(single choice\)/ })
		.click();
	const fieldDialog = page.getByRole("dialog");
	await fieldDialog.locator("#custom-field-name").fill(fieldName);
	await fieldDialog.getByRole("button", { name: "Create" }).click();
	await expect(page).toHaveURL(/ConfigureCustomField/);

	for (const option of ["Alpha", "Beta"]) {
		await page.getByLabel("Add option").fill(option);
		await page.getByLabel("Add option").press("Enter");
		await expect(
			page.getByRole("cell", { name: option, exact: true }),
		).toBeVisible();
	}
	await page
		.getByLabel("Project for the new context")
		.selectOption({ label: projectName });
	await page
		.getByLabel("Issue type for the new context")
		.selectOption({ label: typeName });
	await page.getByRole("button", { name: "Add context" }).click();
	await expect(page.getByRole("cell", { name: projectName })).toBeVisible();

	await page.goto(`/projects/${projectKey}/issues`);
	await page
		.getByRole("button", { name: "Create", exact: true })
		.first()
		.click();
	const createIssue = page.getByRole("dialog");
	await createIssue.getByLabel("Project").selectOption(projectKey);
	await createIssue
		.getByLabel("Issue Type", { exact: true })
		.selectOption({ label: typeName });
	await createIssue.getByLabel("Summary").fill(`E2E admin issue ${run}`);
	await createIssue.getByRole("button", { name: fieldName }).click();
	await page.getByRole("option", { name: "Beta", exact: true }).click();
	await createIssue
		.getByRole("button", { name: "Create", exact: true })
		.click();
	await expect(createIssue).toBeHidden();

	const flagLink = page.getByRole("status").getByRole("link");
	await expect(flagLink).toHaveText(new RegExp(`^${projectKey}-\\d+$`));
	const issueKey = (await flagLink.textContent()) as string;
	await page.goto(`/browse/${issueKey}`);
	await expect(
		page.locator(`button[title="Edit ${fieldName}"]`).first(),
	).toContainText("Beta");
	await expect(page.getByTestId("issue-status")).toContainText(todoName);

	await page.goto("/secure/admin/workflows/ListWorkflows.jspa");
	const workflowRow = page.getByRole("row", {
		name: new RegExp(`^${workflowName}`),
	});
	await workflowRow.getByRole("button", { name: "Copy" }).click();
	const copyDialog = page.getByRole("dialog");
	await copyDialog.getByLabel("Workflow name").fill(copyName);
	await copyDialog.getByRole("button", { name: "Copy", exact: true }).click();
	await expect(copyDialog).toBeHidden();
	await expect(
		page.getByRole("row", { name: new RegExp(copyName) }),
	).toBeVisible();

	await page.goto(
		`/secure/admin/workflows/ViewWorkflowSteps.jspa?workflowName=${encodeURIComponent(copyName)}&mode=text`,
	);
	await page.getByRole("button", { name: "Add status" }).first().click();
	const addStatus = page.getByRole("dialog");
	await addStatus
		.getByLabel("Status", { exact: true })
		.selectOption({ label: "Create a new status..." });
	await addStatus.getByLabel("New status name").fill(reviewName);
	await addStatus.getByLabel("Category").selectOption({ label: "In Progress" });
	await addStatus.getByRole("button", { name: "Add", exact: true }).click();
	await expect(addStatus).toBeHidden();

	for (const [name, from, to] of [
		[startReview, todoName, reviewName],
		[approve, reviewName, doneName],
	] as const) {
		await page.getByRole("button", { name: "Add transition" }).first().click();
		const addTransition = page.getByRole("dialog");
		await addTransition.getByLabel("Transition name").fill(name);
		await addTransition.getByLabel("From status").selectOption({ label: from });
		await addTransition.getByLabel("To status").selectOption({ label: to });
		await addTransition
			.getByRole("button", { name: "Add", exact: true })
			.click();
		await expect(addTransition).toBeHidden();
	}

	await page.getByRole("button", { name: "Publish", exact: true }).click();
	const publish = page.getByRole("dialog");
	await expect(
		publish.getByRole("button", { name: "Publish", exact: true }),
	).toBeEnabled();
	await publish.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(publish).toBeHidden({ timeout: 30_000 });
	await expect(page.getByText("You are editing a draft")).toBeHidden();

	await page.goto(`/plugins/servlet/project-config/${projectKey}/workflows`);
	await page
		.getByLabel("Workflow for Default (all other issue types)")
		.selectOption({ label: copyName });
	const assigned = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			response.url().includes(`/project-config/${projectKey}/workflows`),
	);
	await page.getByRole("button", { name: "Save", exact: true }).click();
	expect((await assigned).status()).toBe(200);

	await page.goto(`/browse/${issueKey}`);
	await page.getByRole("button", { name: startReview, exact: true }).click();
	await expect(page.getByTestId("issue-status")).toContainText(reviewName);
	await page.getByRole("button", { name: approve, exact: true }).click();
	await expect(page.getByTestId("issue-status")).toContainText(doneName);
});

test("a non-admin sees no gear and gets 403 on admin URLs", async ({
	page,
	context,
	baseURL,
}) => {
	const sessionValue = randomUUID();
	const user = await client.query<{ id: string }>(
		`insert into users (username, display_name) values ($1, $2) returning id`,
		[`e2e-na-${run}`, `E2E member ${run}`],
	);
	await client.query(
		`insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + interval '1 day')`,
		[createHash("sha256").update(sessionValue).digest("hex"), user.rows[0]?.id],
	);
	await context.addCookies([
		{ name: "sid", value: sessionValue, url: baseURL as string },
	]);

	await page.goto("/secure/Dashboard.jspa");
	await expect(page.getByRole("link", { name: "RVNA home" })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Administration" }),
	).toHaveCount(0);

	const response = await page.goto("/secure/admin/user/UserBrowser.jspa");
	expect(response?.status()).toBe(403);
	await expect(
		page.getByRole("heading", { name: "403 Forbidden" }),
	).toBeVisible();

	const api = await page.request.get("/api/admin/users");
	expect(api.status()).toBe(403);
	expect(await api.json()).toEqual({ error: "Forbidden" });
});
