import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, withHydrationWait } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const projectKey = `IA${run.slice(0, 5).toUpperCase()}`;
const username = `e2e-issue-access-${run}`;
const session = randomBytes(24).toString("base64url");
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

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const user = await one<{ id: string }>(
		`insert into users (username, display_name) values ($1, $2) returning id`,
		[username, "E2E Issue Reporter"],
	);
	inserted.users.push(user.id);
	await client.query(
		`insert into sessions (id_hash, user_id, expires_at)
		 values ($1, $2, now() + interval '1 day')`,
		[hash(session), user.id],
	);

	const project = await one<{ id: string }>(
		`insert into projects (source_id, key, name, project_type)
		 values ($1, $2, $3, 'software') returning id`,
		[
			`e2e-issue-access:project:${randomUUID()}`,
			projectKey,
			`Issue access ${run}`,
		],
	);
	inserted.projects.push(project.id);

	const type = await one<{ id: string }>(
		`insert into issue_types (source_id, name, subtask)
		 values ($1, $2, false) returning id`,
		[`e2e-issue-access:type:${randomUUID()}`, `Task ${run}`],
	);
	inserted.types.push(type.id);
	const status = await one<{ id: string }>(
		`insert into statuses (source_id, name, category)
		 values ($1, $2, 'new') returning id`,
		[`e2e-issue-access:status:${randomUUID()}`, `To Do ${run}`],
	);
	inserted.statuses.push(status.id);
	const priority = await one<{ id: string }>(
		`insert into priorities (source_id, name, sequence)
		 values ($1, $2, 1) returning id`,
		[`e2e-issue-access:priority:${randomUUID()}`, `Medium ${run}`],
	);
	inserted.priorities.push(priority.id);

	await client.query(
		`insert into issues
		 (source_id, project_id, number, key, type_id, status_id, priority_id,
		  summary, description_html, description_source, reporter_id, created, updated)
		 values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())`,
		[
			`e2e-issue-access:issue:${randomUUID()}`,
			project.id,
			`${projectKey}-1`,
			type.id,
			status.id,
			priority.id,
			`Reporter-only issue ${run}`,
			`<p>Reporter-only issue ${run}</p>`,
			`Reporter-only issue ${run}`,
			user.id,
		],
	);

	const scheme = await one<{ id: string }>(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb) returning id`,
		[
			`e2e-issue-access:scheme:${randomUUID()}`,
			`Issue access scheme ${run}`,
			JSON.stringify([project.id]),
		],
	);
	inserted.schemes.push(scheme.id);
	await client.query(
		`insert into permission_grants
		 (source_id, scheme_id, permission_key, holder_type, holder_parameter, raw)
		 values ($1, $2, 'BROWSE_PROJECTS', 'reporter', null, '{}'::jsonb)`,
		[`e2e-issue-access:grant:${randomUUID()}`, scheme.id],
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
	await client.end();
});

test("a reporter who may browse only the issue still gets the issue page", async ({
	browser,
}) => {
	const baseURL = test.info().project.use.baseURL as string;
	const context = await browser.newContext();
	await context.addCookies([{ name: "sid", value: session, url: baseURL }]);
	const page = withHydrationWait(await context.newPage());

	await page.goto(`/browse/${projectKey}-1`);

	await expect(
		page.getByRole("heading", { name: `Reporter-only issue ${run}` }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", {
			name: "You do not have permission to view this issue",
		}),
	).toHaveCount(0);
	await page.screenshot({
		path: "test-results/issue-only-reporter.png",
		fullPage: true,
	});
	await context.close();
});
