import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { projects } from "../src/lib/server/schema.ts";
import { makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
let app: TestApp;
let admin: TestUser;
let projectId: string;
let projectKey: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	admin = await makeUser(run, "archive-admin", { admin: true });
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `test:${run}:archive-project`,
			key: `AR${run.slice(0, 4).toUpperCase()}`,
			name: `Archive ${run}`,
			projectType: "software",
			archived: true,
			lastIssueNumber: 0,
		})
		.returning({ id: projects.id, key: projects.key });
	projectId = project.id;
	projectKey = project.key;
});

afterAll(async () => {
	await db.delete(projects).where(eq(projects.id, projectId));
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("the archive action rejects a missing state instead of restoring", async () => {
	const response = await app.inject({
		method: "POST",
		url: "/secure/project/ViewProjects.jspa",
		cookies: { sid: admin.session },
		headers: {
			origin: "http://127.0.0.1:3000",
			"content-type": "application/x-www-form-urlencoded",
			accept: "application/json",
			"x-sveltekit-action": "true",
		},
		payload: new URLSearchParams({
			intent: "archive",
			key: projectKey,
		}).toString(),
	});

	expect(response.statusCode).toBe(400);
	const body = response.json() as { type: string; status: number };
	expect(body).toMatchObject({ type: "failure", status: 400 });
	expect(response.body).toContain("Invalid archive state");
	const [project] = await db
		.select({ archived: projects.archived })
		.from(projects)
		.where(eq(projects.id, projectId));
	expect(project?.archived).toBe(true);
});
