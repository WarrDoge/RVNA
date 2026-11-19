import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, withHydrationWait } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const tag = run.toUpperCase();
const projectKey = `PR${tag.slice(0, 4)}`;
const projectName = `E2E Project roles ${run}`;
const issueSummary = `E2E role issue ${run}`;
const username = `e2e-roles-${run}`;
const fullName = `E2E Roles User ${run}`;
const password = `roles-passphrase-${run}`;

let client: Client;
const inserted = {
	projects: [] as string[],
	schemes: [] as string[],
	types: [] as string[],
	statuses: [] as string[],
	priorities: [] as string[],
	users: [] as string[],
};

async function one<T extends Record<string, unknown>>(
	sql: string,
	values: unknown[],
) {
	const result = await client.query<T>(sql, values);
	return result.rows[0] as T;
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const type = await one<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, $2, false) returning id`,
		[`e2e-roles:type:${run}`, `Task ${run}`],
	);
	inserted.types.push(type.id);
	const status = await one<{ id: string }>(
		`insert into statuses (source_id, name, category)
		 values ($1, $2, 'new') returning id`,
		[`e2e-roles:status:${run}`, `To Do ${run}`],
	);
	inserted.statuses.push(status.id);
	const priority = await one<{ id: string }>(
		`insert into priorities (source_id, name, sequence)
		 values ($1, $2, 1) returning id`,
		[`e2e-roles:priority:${run}`, `Medium ${run}`],
	);
	inserted.priorities.push(priority.id);

	const project = await one<{ id: string }>(
		`insert into projects (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'software', 1) returning id`,
		[`e2e-roles:project:${run}`, projectKey, projectName],
	);
	inserted.projects.push(project.id);

	const scheme = await one<{ id: string }>(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb) returning id`,
		[
			`e2e-roles:scheme:${run}`,
			`E2E roles scheme ${run}`,
			JSON.stringify([project.id]),
		],
	);
	inserted.schemes.push(scheme.id);
	await client.query(
		`insert into permission_grants
		 (source_id, scheme_id, permission_key, holder_type, holder_parameter, raw)
		 values ($1, $2, 'BROWSE_PROJECTS', 'projectRole', 'viewer', '{}'::jsonb)`,
		[`e2e-roles:grant:${run}`, scheme.id],
	);

	await client.query(
		`insert into issues
		 (source_id, project_id, number, key, type_id, status_id, priority_id,
		  summary, description_html, description_source, created, updated)
		 values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, now(), now())`,
		[
			`e2e-roles:issue:${run}`,
			project.id,
			`${projectKey}-1`,
			type.id,
			status.id,
			priority.id,
			issueSummary,
			`<p>${issueSummary}</p>`,
			issueSummary,
		],
	);
});

test.afterAll(async () => {
	if (!client) return;
	await client.query(
		"delete from permission_grants where scheme_id = any($1::uuid[])",
		[inserted.schemes],
	);
	await client.query(
		"delete from permission_schemes where id = any($1::uuid[])",
		[inserted.schemes],
	);
	await client.query("delete from projects where id = any($1::uuid[])", [
		inserted.projects,
	]);
	await client.query("delete from issue_types where id = any($1::uuid[])", [
		inserted.types,
	]);
	await client.query("delete from statuses where id = any($1::uuid[])", [
		inserted.statuses,
	]);
	await client.query("delete from priorities where id = any($1::uuid[])", [
		inserted.priorities,
	]);
	await client.query("delete from users where id = any($1::uuid[])", [
		inserted.users,
	]);
	await client.query("delete from users where username = $1", [username]);
	await client.query("delete from audit_log where summary like $1", [
		`%${username}%`,
	]);
	await client.end();
});

test("an administrator adds a local user to a project role and that user sees the project", async ({
	page,
	browser,
}) => {
	test.setTimeout(120_000);

	await page.goto("/auth/login?returnTo=/secure/admin/user/UserBrowser.jspa");
	await expect(
		page.getByRole("heading", { name: "Users", exact: true }),
	).toBeVisible();

	await page.getByRole("button", { name: "Create user" }).click();
	const createUser = page.getByRole("dialog");
	await createUser.getByRole("button", { name: "Create" }).click();
	await expect(createUser.getByText("Username is required.")).toBeVisible();
	await expect(createUser.getByText("Full name is required.")).toBeVisible();
	await createUser.getByLabel("Username", { exact: true }).fill(username);
	await createUser.getByLabel("Full name", { exact: true }).fill(fullName);
	await createUser
		.getByLabel("Email", { exact: true })
		.fill(`${username}@example.test`);
	await createUser.getByLabel("Password", { exact: true }).fill(password);
	await createUser.getByRole("button", { name: "Create" }).click();
	await expect(createUser).toHaveCount(0);

	const created = await client.query<{ id: string }>(
		"select id from users where username = $1",
		[username],
	);
	const userId = created.rows[0]?.id;
	if (!userId) throw new Error("The local user was not created");
	inserted.users.push(userId);

	await page.goto(`/plugins/servlet/project-config/${projectKey}/roles`);
	await expect(
		page.getByRole("heading", { name: "Users and roles" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Add users to a role" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel("Role")).toHaveValue("");
	await expect(
		dialog.getByRole("button", { name: "Add", exact: true }),
	).toBeDisabled();
	await dialog.getByLabel("Search users").fill(username);
	await dialog.getByRole("button", { name: new RegExp(fullName) }).click();
	await dialog.getByLabel("Role").selectOption("viewer");
	await expect(
		dialog.getByRole("button", { name: "Add", exact: true }),
	).toBeEnabled();
	await dialog.getByRole("button", { name: "Add", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(
		page.getByRole("cell", { name: new RegExp(fullName) }),
	).toBeVisible();
	await page.screenshot({
		path: "test-results/project-roles.png",
		fullPage: true,
	});

	const context = await browser.newContext();
	const userPage = withHydrationWait(await context.newPage());
	await userPage.goto("/login.jsp?local=1");
	await userPage.getByLabel("Username").fill(username);
	await userPage.getByLabel("Password").fill(password);
	await userPage.getByRole("button", { name: "Log in" }).click();
	await expect(userPage).toHaveURL(/\/secure\/Dashboard\.jspa$/);

	await userPage.goto(`/projects/${projectKey}/issues`);
	await expect(
		userPage.getByRole("heading", { name: "Issues", exact: true }),
	).toBeVisible();
	await expect(
		userPage.getByRole("cell", { name: issueSummary }),
	).toBeVisible();
	await userPage.screenshot({
		path: "test-results/project-roles-user.png",
		fullPage: true,
	});
	await context.close();
});
