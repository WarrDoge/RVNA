import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	groups,
	issues,
	issueTypes,
	projects,
	statuses,
	users,
} from "../src/lib/server/schema.ts";
import { newRun } from "./admin-helpers.ts";

const run = newRun();
const name = (label: string) => `t-${run}-${label}`;
const projectKey = `T${run.slice(0, 6).toUpperCase()}`;
let projectId: string;
let typeId: string;
let statusId: string;

beforeAll(async () => {
	await runMigrations();
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: name("project"),
			key: projectKey,
			name: `Schema constraints ${run}`,
			projectType: "software",
		})
		.returning({ id: projects.id });
	projectId = project.id;
	const [type] = await db
		.insert(issueTypes)
		.values({ sourceId: name("type"), name: `Type ${run}` })
		.returning({ id: issueTypes.id });
	typeId = type.id;
	const [status] = await db
		.insert(statuses)
		.values({
			sourceId: name("status"),
			name: `Status ${run}`,
			category: "new",
		})
		.returning({ id: statuses.id });
	statusId = status.id;
});

afterAll(async () => {
	await pool.query("delete from projects where id = $1", [projectId]);
	await pool.query("delete from users where username ilike $1", [`t-${run}-%`]);
	await pool.query("delete from groups where name ilike $1", [`t-${run}-%`]);
	await pool.end();
});

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const direct = (error as { code?: unknown }).code;
	if (typeof direct === "string") return direct;
	const cause = (error as { cause?: unknown }).cause;
	if (typeof cause !== "object" || cause === null) return undefined;
	const code = (cause as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

async function uniqueViolation(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		return errorCode(error);
	}
	return null;
}

test("a username is unique ignoring case", async () => {
	await db.insert(users).values({
		username: name("CaseUser"),
		displayName: "Case user",
	});
	expect(
		await uniqueViolation(
			db.insert(users).values({
				username: name("caseuser"),
				displayName: "Case user",
			}),
		),
	).toBe("23505");
});

test("a group name is unique ignoring case", async () => {
	await db.insert(groups).values({ name: name("CaseGroup"), local: true });
	expect(
		await uniqueViolation(
			db.insert(groups).values({ name: name("casegroup"), local: true }),
		),
	).toBe("23505");
});

test("an issue number is unique within its project", async () => {
	await db.insert(issues).values({
		sourceId: name("issue-first"),
		projectId,
		number: 1,
		key: `${projectKey}-1`,
		typeId,
		statusId,
		summary: "First issue",
	});
	expect(
		await uniqueViolation(
			db.insert(issues).values({
				sourceId: name("issue-copy"),
				projectId,
				number: 1,
				key: `${projectKey}-1-copy`,
				typeId,
				statusId,
				summary: "Duplicate number",
			}),
		),
	).toBe("23505");
});

test("sessions and API tokens are indexed by user", async () => {
	const { rows } = await pool.query<{ indexname: string }>(
		`select indexname from pg_indexes
		 where schemaname = 'public' and tablename in ('sessions', 'api_tokens')`,
	);
	const names = rows.map((row) => row.indexname);
	expect(names).toContain("sessions_user_id_idx");
	expect(names).toContain("api_tokens_user_id_idx");
});

test("the project key is not indexed twice", async () => {
	const { rows } = await pool.query<{ indexname: string }>(
		`select indexname from pg_indexes
		 where schemaname = 'public' and tablename = 'projects'`,
	);
	const names = rows.map((row) => row.indexname);
	expect(names).not.toContain("projects_key_idx");
	expect(names).toContain("projects_key_unique");
});
