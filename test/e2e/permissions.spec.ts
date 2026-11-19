import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, withHydrationWait } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const viewerKey = `PV${run.slice(0, 5).toUpperCase()}`;
const hiddenKey = `PH${run.slice(0, 5).toUpperCase()}`;
const viewerName = `e2e-perm-viewer-${run}`;
const hiddenName = `e2e-perm-hidden-${run}`;
const viewerSession = randomBytes(24).toString("base64url");
const hiddenSession = randomBytes(24).toString("base64url");
const inserted = {
	projects: [] as string[],
	users: [] as string[],
	schemes: [] as string[],
	statuses: [] as string[],
	types: [] as string[],
	priorities: [] as string[],
};

let client: Client;

function hash(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

async function one<T extends Record<string, unknown>>(
	sql: string,
	values: unknown[],
) {
	const result = await client.query<T>(sql, values);
	return result.rows[0] as T;
}

async function createUser(username: string, displayName: string) {
	const row = await one<{ id: string }>(
		`insert into users (username, display_name) values ($1, $2) returning id`,
		[username, displayName],
	);
	inserted.users.push(row.id);
	await client.query(
		`insert into sessions (id_hash, user_id, expires_at)
		 values ($1, $2, now() + interval '1 day')`,
		[hash(username === viewerName ? viewerSession : hiddenSession), row.id],
	);
	return row.id;
}

async function createIssue(projectId: string, key: string, summary: string) {
	const typeId = await one<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, $2, false) returning id`,
		[`e2e-perm:type:${randomUUID()}`, `Task ${run}`],
	).then((row) => {
		inserted.types.push(row.id);
		return row.id;
	});
	const statusId = await one<{ id: string }>(
		`insert into statuses (source_id, name, category)
		 values ($1, $2, 'new') returning id`,
		[`e2e-perm:status:${randomUUID()}`, `To Do ${run}`],
	).then((row) => {
		inserted.statuses.push(row.id);
		return row.id;
	});
	const priorityId = await one<{ id: string }>(
		`insert into priorities (source_id, name, sequence)
		 values ($1, $2, 1) returning id`,
		[`e2e-perm:priority:${randomUUID()}`, `Medium ${run}`],
	).then((row) => {
		inserted.priorities.push(row.id);
		return row.id;
	});
	await client.query(
		`insert into issues
		 (source_id, project_id, number, key, type_id, status_id, priority_id,
		  summary, description_html, description_source, created, updated)
		 values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, now(), now())`,
		[
			`e2e-perm:issue:${randomUUID()}`,
			projectId,
			key,
			typeId,
			statusId,
			priorityId,
			summary,
			`<p>${summary}</p>`,
			summary,
		],
	);
}

async function createProject(key: string, name: string) {
	const row = await one<{ id: string }>(
		`insert into projects (source_id, key, name, project_type)
		 values ($1, $2, $3, 'software') returning id`,
		[`e2e-perm:project:${randomUUID()}`, key, name],
	);
	inserted.projects.push(row.id);
	return row.id;
}

async function createScheme(projectId: string, grants: string[]) {
	const scheme = await one<{ id: string }>(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb) returning id`,
		[
			`e2e-perm:scheme:${randomUUID()}`,
			`E2E scheme ${run}`,
			JSON.stringify([projectId]),
		],
	);
	inserted.schemes.push(scheme.id);
	for (const grant of grants) {
		const [permission, holderType, holderParameter] = grant.split("|");
		await client.query(
			`insert into permission_grants
			 (source_id, scheme_id, permission_key, holder_type, holder_parameter, raw)
			 values ($1, $2, $3, $4, $5, '{}'::jsonb)`,
			[
				`e2e-perm:grant:${randomUUID()}`,
				scheme.id,
				permission,
				holderType,
				holderParameter ?? null,
			],
		);
	}
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const viewerId = await createUser(viewerName, "E2E Viewer");
	await createUser(hiddenName, "E2E Hidden");

	const viewerProject = await createProject(viewerKey, `Viewer project ${run}`);
	const hiddenProject = await createProject(hiddenKey, `Hidden project ${run}`);
	await createIssue(viewerProject, `${viewerKey}-1`, `Viewer issue ${run}`);
	await createIssue(hiddenProject, `${hiddenKey}-1`, `Hidden issue ${run}`);

	await createScheme(viewerProject, ["BROWSE_PROJECTS|projectRole|viewer"]);
	await client.query(
		`insert into project_role_actors
		 (source_id, project_id, role_id, role_name, actor_type, actor_parameter,
		  actor_display_name, raw)
		 values ($1, $2, 'viewer', 'viewer', 'user', $3, $3, '{}'::jsonb)`,
		[`e2e-perm:actor:${randomUUID()}`, viewerProject, viewerName],
	);
	await createScheme(hiddenProject, ["BROWSE_PROJECTS|group|e2e-perm-nobody"]);

	expect(viewerId).toBeTruthy();
});

test.afterAll(async () => {
	if (client) {
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
		await client.end();
	}
});

function baseUrl() {
	return test.info().project.use.baseURL as string;
}

test("a user without browse permission sees the permission page", async ({
	browser,
}) => {
	const context = await browser.newContext();
	await context.addCookies([
		{ name: "sid", value: hiddenSession, url: baseUrl() },
	]);
	const page = withHydrationWait(await context.newPage());
	await page.goto(`/browse/${hiddenKey}-1`);
	await expect(
		page.getByRole("heading", {
			name: "You do not have permission to view this issue",
		}),
	).toBeVisible();
	await page.screenshot({
		path: "test-results/permission-page.png",
		fullPage: true,
	});
	await context.close();
});

test("a viewer sees the issue without edit controls", async ({ browser }) => {
	const context = await browser.newContext();
	await context.addCookies([
		{ name: "sid", value: viewerSession, url: baseUrl() },
	]);
	const page = withHydrationWait(await context.newPage());
	await page.goto(`/browse/${viewerKey}-1`);
	await expect(
		page.getByRole("heading", { name: `Viewer issue ${run}` }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Add comment" })).toHaveCount(
		0,
	);
	await page.screenshot({
		path: "test-results/viewer-issue.png",
		fullPage: true,
	});
	await context.close();
});
