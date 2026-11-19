import { createHash, randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { env } from "../src/lib/server/env.ts";
import {
	isExemptWriteRoute,
	mutatingMethods,
	writeRouteScopes,
} from "../src/lib/server/project-keys.ts";
import {
	attachments,
	auditLog,
	comments,
	components,
	fieldContexts,
	fields,
	issueLinks,
	issues,
	issueTypes,
	linkTypes,
	priorities,
	projectIssueTypes,
	projectPreviousKeys,
	projects,
	projectWorkflows,
	resolutions,
	statuses,
	versions,
	workflowStatuses,
	workflows,
	workflowTransitions,
} from "../src/lib/server/schema.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import { allAppRoutes, routeKey } from "./route-inventory.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const tag = `test-${run}`;

const keyFor = (label: string) => `${label}${run.slice(0, 5).toUpperCase()}`;

let app: TestApp;
let admin: TestUser;
let member: TestUser;
let workflowId: string;
let otherWorkflowId: string;
let taskTypeId: string;
let bugTypeId: string;
let todoStatusId: string;
let doneStatusId: string;
let linkTypeId: string;
let fieldId: string;
let priorityId: string;

const projectIds: string[] = [];

type ProjectRow = { id: string; key: string; name: string };

async function makeProject(
	label: string,
	options: { name?: string; workflow?: boolean } = {},
): Promise<ProjectRow> {
	const key = keyFor(label);
	const [row] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project:${label}`,
			key,
			name: `${tag} ${options.name ?? label}`,
			projectType: "software",
			leadId: admin.id,
			lastIssueNumber: 0,
		})
		.returning({ id: projects.id, key: projects.key, name: projects.name });
	projectIds.push(row.id);

	await db.insert(projectIssueTypes).values(
		[taskTypeId, bugTypeId].map((issueTypeId) => ({
			sourceId: `${tag}:project-type:${label}:${issueTypeId}`,
			projectId: row.id,
			issueTypeId,
		})),
	);
	if (options.workflow !== false) {
		await db.insert(projectWorkflows).values({
			sourceId: `${tag}:project-workflow:${label}`,
			projectId: row.id,
			issueTypeId: null,
			workflowId,
		});
	}
	return row;
}

async function createIssue(projectKey: string, summary = "Fixture issue") {
	const response = await injectAs(app, admin.session, "POST", "/api/issues", {
		project: projectKey,
		type: taskTypeId,
		summary: `${tag} ${summary}`,
	});
	expect(response.statusCode).toBe(201);
	return response.json() as { id: string; key: string; number: number };
}

async function insertAttachment(
	issueId: string,
	content: string,
	fileName = "note.txt",
) {
	const id = randomUUID();
	const sha256 = createHash("sha256").update(content).digest("hex");
	const storagePath = join(sha256, id);
	const path = join(env.ATTACHMENTS_DIR, storagePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
	const [row] = await db
		.insert(attachments)
		.values({
			sourceId: `local:${id}`,
			issueId,
			fileName,
			mimeType: "text/plain",
			size: Buffer.byteLength(content),
			authorId: admin.id,
			created: new Date(),
			storagePath,
			sha256,
		})
		.returning({ id: attachments.id });
	return { id: row.id, storagePath, sha256, path };
}

async function countRows(table: PgTable, where: SQL) {
	const [row] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(table)
		.where(where);
	return row?.total ?? 0;
}

async function auditRows(action: string, entityId: string) {
	const rows = await db
		.select()
		.from(auditLog)
		.where(eq(auditLog.action, action));
	return rows.filter((row) => row.entityId === entityId);
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	admin = await makeUser(run, "admin", { admin: true });
	member = await makeUser(run, "member");

	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}:status:todo`, name: `${tag} To Do`, category: "new" },
			{ sourceId: `${tag}:status:done`, name: `${tag} Done`, category: "done" },
		])
		.returning();
	todoStatusId = statusRows[0].id;
	doneStatusId = statusRows[1].id;

	const typeRows = await db
		.insert(issueTypes)
		.values([
			{ sourceId: `${tag}:type:task`, name: `${tag} Task` },
			{ sourceId: `${tag}:type:bug`, name: `${tag} Bug` },
		])
		.returning();
	taskTypeId = typeRows[0].id;
	bugTypeId = typeRows[1].id;

	const [priority] = await db
		.insert(priorities)
		.values({ sourceId: `${tag}:priority`, name: `${tag} Medium`, sequence: 1 })
		.returning();
	priorityId = priority.id;

	await db.insert(resolutions).values({
		sourceId: `${tag}:resolution`,
		name: `${tag} Fixed`,
		sequence: 1,
	});

	const [linkType] = await db
		.insert(linkTypes)
		.values({
			sourceId: `${tag}:link-type`,
			name: `${tag} Blocks`,
			inward: `${tag} is blocked by`,
			outward: `${tag} blocks`,
		})
		.returning();
	linkTypeId = linkType.id;

	const [field] = await db
		.insert(fields)
		.values({ sourceId: `${tag}:field`, name: `${tag} field`, type: "text" })
		.returning();
	fieldId = field.id;

	const workflowRows = await db
		.insert(workflows)
		.values([
			{
				sourceId: `${tag}:workflow`,
				name: `${tag} workflow`,
				initialStatusId: todoStatusId,
			},
			{
				sourceId: `${tag}:workflow:other`,
				name: `${tag} other workflow`,
				initialStatusId: todoStatusId,
			},
		])
		.returning();
	workflowId = workflowRows[0].id;
	otherWorkflowId = workflowRows[1].id;

	for (const id of [workflowId, otherWorkflowId]) {
		await db.insert(workflowStatuses).values([
			{
				sourceId: `${tag}:ws:${id}:todo`,
				workflowId: id,
				statusId: todoStatusId,
			},
			{
				sourceId: `${tag}:ws:${id}:done`,
				workflowId: id,
				statusId: doneStatusId,
			},
		]);
	}
	await db.insert(workflowTransitions).values({
		sourceId: `${tag}:transition`,
		workflowId,
		name: "Finish",
		fromStatusId: todoStatusId,
		toStatusId: doneStatusId,
		sequence: 0,
	});
});

afterAll(async () => {
	if (projectIds.length > 0) {
		await pool.query("delete from projects where id = any($1::uuid[])", [
			projectIds,
		]);
	}
	await pool.query("delete from audit_log where actor_id = any($1::uuid[])", [
		[admin.id, member.id],
	]);
	await pool.query("delete from workflows where id = any($1::uuid[])", [
		[workflowId, otherWorkflowId],
	]);
	await pool.query("delete from issue_types where id = any($1::uuid[])", [
		[taskTypeId, bugTypeId],
	]);
	await pool.query("delete from statuses where id = any($1::uuid[])", [
		[todoStatusId, doneStatusId],
	]);
	await pool.query("delete from priorities where id = $1", [priorityId]);
	await pool.query("delete from link_types where id = $1", [linkTypeId]);
	await pool.query("delete from fields where id = $1", [fieldId]);
	await cleanupTestData(run);
	await app.close();
});

function adminProjects(query = "") {
	return injectAs(
		app,
		admin.session,
		"GET",
		`/api/admin/projects${query === "" ? "" : `?${query}`}`,
	);
}

function createProject(body: Record<string, unknown>) {
	return injectAs(app, admin.session, "POST", "/api/admin/projects", body);
}

describe("project avatars", () => {
	test("the admin list emits the local avatar URL, not the imported one", async () => {
		const project = await makeProject("av");
		await db
			.update(projects)
			.set({
				avatarUrl: "https://jira.example/secure/projectavatar?avatarId=1",
			})
			.where(eq(projects.id, project.id));
		const response = await adminProjects(`query=${project.key}`);
		expect(response.statusCode).toBe(200);
		expect(response.json()[0].avatarUrl).toBe(
			`/api/avatars/projects/${project.id}`,
		);
	});
});

describe("project keys", () => {
	test("accepts keys shaped like AB, A1 and ABCDEFGHIJ", async () => {
		const valid = [
			`A${run.slice(0, 1).toUpperCase()}`,
			`A1${run.slice(0, 2).toUpperCase()}`,
			`K${run.slice(0, 8).toUpperCase()}X`,
		];
		for (const key of valid) {
			expect(key.length).toBeGreaterThanOrEqual(2);
			expect(key.length).toBeLessThanOrEqual(10);
			const response = await createProject({
				name: `${tag} key ${key}`,
				key,
				type: "software",
			});
			expect(response.statusCode, key).toBe(201);
			const body = response.json();
			expect(body.key).toBe(key);
			expect(body.archived).toBe(false);
			expect(body.issueCount).toBe(0);
			expect(body.previousKeys).toEqual([]);
			expect(body.lead?.id).toBe(admin.id);
			projectIds.push(body.id);
		}
	});

	test("refuses keys that break the rule and says why", async () => {
		const invalid = [
			"A",
			"1AB",
			"abc",
			"AB-C",
			"ABCDEFGHIJK",
			"",
			"A B",
			"ÜBER",
			"AB_1",
		];
		for (const key of invalid) {
			const response = await createProject({
				name: `${tag} bad ${key}`,
				key,
				type: "software",
			});
			expect(response.statusCode, key).toBe(400);
			const message = response.json().error as string;
			expect(message.length).toBeGreaterThan(0);
			if (key === "abc") expect(message).toMatch(/uppercase/i);
			if (key === "ABCDEFGHIJK") expect(message).toMatch(/2 to 10/);
		}
	});

	test("refuses a key or a name another project holds", async () => {
		const project = await makeProject("U", { name: "Uniqueness" });

		const sameKey = await createProject({
			name: `${tag} other name`,
			key: project.key,
			type: "software",
		});
		expect(sameKey.statusCode).toBe(409);
		expect(sameKey.json().error).toContain(project.key);

		const sameName = await createProject({
			name: project.name.toLowerCase(),
			key: keyFor("V"),
			type: "software",
		});
		expect(sameName.statusCode).toBe(409);
		expect(sameName.json().error).toMatch(/already exists/i);
	});

	test("a previous key stays reserved", async () => {
		const project = await makeProject("W", { name: "Reserved" });
		const oldKey = project.key;
		const newKey = keyFor("X");

		const renamed = await injectAs(
			app,
			admin.session,
			"PATCH",
			`/api/admin/projects/${oldKey}`,
			{ key: newKey },
		);
		expect(renamed.statusCode).toBe(200);
		expect(renamed.json().key).toBe(newKey);
		expect(renamed.json().previousKeys).toEqual([oldKey]);

		const reused = await createProject({
			name: `${tag} reuse`,
			key: oldKey,
			type: "software",
		});
		expect(reused.statusCode).toBe(409);
		expect(reused.json().error).toContain(oldKey);
	});
});

describe("creating projects", () => {
	test("makes the lead a project administrator", async () => {
		const response = await createProject({
			name: `${tag} Lead admin`,
			key: keyFor("L"),
			type: "software",
		});
		expect(response.statusCode).toBe(201);
		projectIds.push(response.json().id);
		const actors = await pool.query(
			"select role_id from project_role_actors where project_id = $1 and actor_parameter = $2",
			[response.json().id, admin.username],
		);
		expect(actors.rows).toEqual([{ role_id: "admin" }]);
	});

	test("copies issue types, workflows and field contexts from a template", async () => {
		const template = await makeProject("T", { name: "Template" });
		await db.insert(projectWorkflows).values({
			sourceId: `${tag}:project-workflow:template:bug`,
			projectId: template.id,
			issueTypeId: bugTypeId,
			workflowId: otherWorkflowId,
		});
		await db.insert(fieldContexts).values([
			{ fieldId, projectId: template.id, issueTypeId: taskTypeId },
			{ fieldId, projectId: null, issueTypeId: null },
		]);
		await createIssue(template.key, "template issue");
		await injectAs(
			app,
			admin.session,
			"POST",
			`/api/projects/${template.key}/components`,
			{ name: "Template component" },
		);
		await injectAs(
			app,
			admin.session,
			"POST",
			`/api/projects/${template.key}/versions`,
			{ name: "1.0" },
		);

		const key = keyFor("B");
		const response = await createProject({
			name: `${tag} From template`,
			key,
			type: "service_desk",
			templateProjectKey: template.key,
		});
		expect(response.statusCode).toBe(201);
		const created = response.json();
		projectIds.push(created.id);
		expect(created.type).toBe("service_desk");

		const types = await db
			.select({ issueTypeId: projectIssueTypes.issueTypeId })
			.from(projectIssueTypes)
			.where(eq(projectIssueTypes.projectId, created.id));
		expect(types.map((row) => row.issueTypeId).sort()).toEqual(
			[taskTypeId, bugTypeId].sort(),
		);

		const assignments = await db
			.select({
				issueTypeId: projectWorkflows.issueTypeId,
				workflowId: projectWorkflows.workflowId,
			})
			.from(projectWorkflows)
			.where(eq(projectWorkflows.projectId, created.id));
		expect(
			assignments
				.map((row) => `${row.issueTypeId ?? "default"}:${row.workflowId}`)
				.sort(),
		).toEqual(
			[`default:${workflowId}`, `${bugTypeId}:${otherWorkflowId}`].sort(),
		);

		const contexts = await db
			.select({
				fieldId: fieldContexts.fieldId,
				issueTypeId: fieldContexts.issueTypeId,
			})
			.from(fieldContexts)
			.where(eq(fieldContexts.projectId, created.id));
		expect(contexts).toEqual([{ fieldId, issueTypeId: taskTypeId }]);

		expect(
			await countRows(components, eq(components.projectId, created.id)),
		).toBe(0);
		expect(await countRows(versions, eq(versions.projectId, created.id))).toBe(
			0,
		);
		expect(await countRows(issues, eq(issues.projectId, created.id))).toBe(0);

		const audits = await auditRows("project.create", created.id);
		expect(audits).toHaveLength(1);
		expect(audits[0].summary).toContain(key);
		expect(audits[0].changes).toMatchObject({
			to: { key, template: template.key },
		});
	});

	test("without a template copies every issue type and the most used default workflow", async () => {
		// Two extra projects make the "most used default workflow" rule observable on an empty database.
		const first = await makeProject("C", { name: "Default one" });
		await makeProject("D", { name: "Default two" });
		await db
			.update(projectWorkflows)
			.set({ workflowId: otherWorkflowId })
			.where(eq(projectWorkflows.projectId, first.id));

		const expected = await pool.query<{ workflow_id: string }>(
			`select pw.workflow_id
			 from project_workflows pw
			 join workflows w on w.id = pw.workflow_id
			 where pw.issue_type_id is null
			 group by pw.workflow_id, w.name
			 order by count(*) desc, w.name asc
			 limit 1`,
		);
		const expectedWorkflow = expected.rows[0]?.workflow_id ?? null;

		const key = keyFor("E");
		const response = await createProject({
			name: `${tag} Default set`,
			key,
			type: "software",
		});
		expect(response.statusCode).toBe(201);
		const created = response.json();
		projectIds.push(created.id);

		const types = await db
			.select({ issueTypeId: projectIssueTypes.issueTypeId })
			.from(projectIssueTypes)
			.where(eq(projectIssueTypes.projectId, created.id));
		const allTypes = await db.select({ id: issueTypes.id }).from(issueTypes);
		expect(types.map((row) => row.issueTypeId).sort()).toEqual(
			allTypes.map((row) => row.id).sort(),
		);

		const defaults = await db
			.select({ workflowId: projectWorkflows.workflowId })
			.from(projectWorkflows)
			.where(
				and(
					eq(projectWorkflows.projectId, created.id),
					isNull(projectWorkflows.issueTypeId),
				),
			);
		if (expectedWorkflow) {
			expect(defaults).toEqual([{ workflowId: expectedWorkflow }]);
		} else {
			expect(defaults).toEqual([]);
		}
	});
});

describe("editing projects", () => {
	test("updates name, type, category and lead and audits the change", async () => {
		const project = await makeProject("F", { name: "Editable" });
		const response = await injectAs(
			app,
			admin.session,
			"PATCH",
			`/api/admin/projects/${project.key}`,
			{
				name: `${tag} Renamed`,
				type: "service_desk",
				category: "Team",
				leadId: member.id,
			},
		);
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.name).toBe(`${tag} Renamed`);
		expect(body.type).toBe("service_desk");
		expect(body.category).toBe("Team");
		expect(body.lead?.id).toBe(member.id);

		const audits = await auditRows("project.update", project.id);
		expect(audits).toHaveLength(1);
		expect(audits[0].changes).toMatchObject({
			from: { name: project.name },
			to: { name: `${tag} Renamed` },
		});

		const cleared = await injectAs(
			app,
			admin.session,
			"PATCH",
			`/api/admin/projects/${project.key}`,
			{ leadId: null, category: null },
		);
		expect(cleared.statusCode).toBe(200);
		expect(cleared.json().lead).toBeNull();
		expect(cleared.json().category).toBeNull();
	});

	test("refuses a name another project uses, ignoring case", async () => {
		const project = await makeProject("G", { name: "Named" });
		const other = await makeProject("H", { name: "Other named" });
		const response = await injectAs(
			app,
			admin.session,
			"PATCH",
			`/api/admin/projects/${project.key}`,
			{ name: other.name.toUpperCase() },
		);
		expect(response.statusCode).toBe(409);
		expect(response.json().error).toMatch(/already exists/i);
	});

	test("changes the key, rewrites issue keys and keeps the old key working", async () => {
		const project = await makeProject("I", { name: "Renamable" });
		const first = await createIssue(project.key, "first");
		const second = await createIssue(project.key, "second");
		expect(first.key).toBe(`${project.key}-1`);
		expect(second.key).toBe(`${project.key}-2`);

		const newKey = keyFor("J");
		const response = await injectAs(
			app,
			admin.session,
			"PATCH",
			`/api/admin/projects/${project.key}`,
			{ key: newKey },
		);
		expect(response.statusCode).toBe(200);
		expect(response.json().key).toBe(newKey);
		expect(response.json().previousKeys).toEqual([project.key]);
		expect(response.json().issueCount).toBe(2);

		const renamed = await db
			.select({ key: issues.key })
			.from(issues)
			.where(eq(issues.projectId, project.id))
			.orderBy(issues.number);
		expect(renamed.map((row) => row.key)).toEqual([
			`${newKey}-1`,
			`${newKey}-2`,
		]);

		const previous = await db
			.select({ key: projectPreviousKeys.key })
			.from(projectPreviousKeys)
			.where(eq(projectPreviousKeys.projectId, project.id));
		expect(previous).toEqual([{ key: project.key }]);

		const audit = await auditRows("project.update", project.id);
		expect(audit).toHaveLength(1);
		expect(audit[0].changes).toMatchObject({
			from: { key: project.key },
			to: { key: newKey },
			renamedIssues: 2,
		});

		const oldIssue = await injectAs(
			app,
			admin.session,
			"GET",
			`/api/issues/${project.key}-1`,
		);
		expect(oldIssue.statusCode).toBe(200);
		expect(oldIssue.json().key).toBe(`${newKey}-1`);

		const oldProject = await injectAs(
			app,
			admin.session,
			"GET",
			`/api/projects/${project.key}`,
		);
		expect(oldProject.statusCode).toBe(200);
		expect(oldProject.json().key).toBe(newKey);

		const created = await injectAs(app, admin.session, "POST", "/api/issues", {
			project: project.key,
			type: taskTypeId,
			summary: `${tag} created through the old key`,
		});
		expect(created.statusCode).toBe(201);
		expect(created.json().key).toBe(`${newKey}-3`);

		const browse = await injectAs(
			app,
			admin.session,
			"GET",
			`/browse/${project.key}-1?focusedCommentId=1`,
		);
		expect(browse.statusCode).toBe(302);
		expect(browse.headers.location).toBe(
			`/browse/${newKey}-1?focusedCommentId=1`,
		);

		const projectPage = await injectAs(
			app,
			admin.session,
			"GET",
			`/projects/${project.key}/issues`,
		);
		expect(projectPage.statusCode).toBe(302);
		expect(projectPage.headers.location).toBe(`/projects/${newKey}/issues`);

		const unknownBrowse = await injectAs(
			app,
			admin.session,
			"GET",
			"/browse/ZZUNKNOWN-9",
		);
		expect(unknownBrowse.statusCode).not.toBe(302);

		const unknownIssue = await injectAs(
			app,
			admin.session,
			"GET",
			"/api/issues/ZZUNKNOWN-9",
		);
		expect(unknownIssue.statusCode).toBe(404);

		// Changing back works and drops the key from the previous keys.
		const back = await injectAs(
			app,
			admin.session,
			"PATCH",
			`/api/admin/projects/${newKey}`,
			{ key: project.key },
		);
		expect(back.statusCode).toBe(200);
		expect(back.json().key).toBe(project.key);
		expect(back.json().previousKeys).toEqual([newKey]);

		const backIssues = await db
			.select({ key: issues.key })
			.from(issues)
			.where(eq(issues.projectId, project.id))
			.orderBy(issues.number);
		expect(backIssues.map((row) => row.key)).toEqual([
			`${project.key}-1`,
			`${project.key}-2`,
			`${project.key}-3`,
		]);

		const stillResolves = await injectAs(
			app,
			admin.session,
			"GET",
			`/api/issues/${newKey}-1`,
		);
		expect(stillResolves.statusCode).toBe(200);
		expect(stillResolves.json().key).toBe(`${project.key}-1`);
	});

	test("refuses a key another project holds as a previous key", async () => {
		const project = await makeProject("K", { name: "Prev holder" });
		const oldKey = project.key;
		const newKey = keyFor("L");
		await injectAs(
			app,
			admin.session,
			"PATCH",
			`/api/admin/projects/${oldKey}`,
			{ key: newKey },
		);
		const other = await makeProject("M", { name: "Prev taker" });
		const response = await injectAs(
			app,
			admin.session,
			"PATCH",
			`/api/admin/projects/${other.key}`,
			{ key: oldKey },
		);
		expect(response.statusCode).toBe(409);
		expect(response.json().error).toContain(oldKey);
	});
});

describe("archiving", () => {
	test("archives, hides from the project picker and restores", async () => {
		const project = await makeProject("N", { name: "Archivable" });

		const archive = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/admin/projects/${project.key}/archive`,
		);
		expect(archive.statusCode).toBe(200);
		expect(archive.json().archived).toBe(true);

		const again = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/admin/projects/${project.key}/archive`,
		);
		expect(again.statusCode).toBe(200);
		expect(again.json().archived).toBe(true);
		expect(await auditRows("project.archive", project.id)).toHaveLength(1);

		const archivedList = await adminProjects("archived=true");
		expect(archivedList.statusCode).toBe(200);
		expect(
			archivedList.json().map((row: { key: string }) => row.key),
		).toContain(project.key);

		const activeList = await adminProjects("archived=false");
		expect(
			activeList.json().map((row: { key: string }) => row.key),
		).not.toContain(project.key);

		const allList = await adminProjects();
		expect(allList.json().map((row: { key: string }) => row.key)).toContain(
			project.key,
		);

		const filtered = await adminProjects(
			`query=${encodeURIComponent(project.key)}`,
		);
		expect(filtered.json()).toHaveLength(1);
		expect(filtered.json()[0].key).toBe(project.key);

		const picker = await injectAs(app, admin.session, "GET", "/api/projects");
		expect(picker.json().map((row: { key: string }) => row.key)).not.toContain(
			project.key,
		);

		const restore = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/admin/projects/${project.key}/restore`,
		);
		expect(restore.statusCode).toBe(200);
		expect(restore.json().archived).toBe(false);
		expect(await auditRows("project.restore", project.id)).toHaveLength(1);

		const pickerAgain = await injectAs(
			app,
			admin.session,
			"GET",
			"/api/projects",
		);
		expect(pickerAgain.json().map((row: { key: string }) => row.key)).toContain(
			project.key,
		);
	});
});

describe("read-only projects", () => {
	test("refuses every write to an archived project and allows reads", async () => {
		const project = await makeProject("O", { name: "Frozen" });
		const issue = await createIssue(project.key, "frozen issue");
		const other = await makeProject("P", { name: "Target" });
		const otherIssue = await createIssue(other.key, "target issue");

		const comment = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/issues/${issue.key}/comments`,
			{ body: "A comment" },
		);
		expect(comment.statusCode).toBe(201);
		const worklog = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/issues/${issue.key}/worklogs`,
			{ seconds: 600 },
		);
		expect(worklog.statusCode).toBe(201);
		const link = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/issues/${issue.key}/links`,
			{ typeId: linkTypeId, direction: "outward", targetKey: otherIssue.key },
		);
		expect(link.statusCode).toBe(201);
		const component = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/projects/${project.key}/components`,
			{ name: "Frozen component" },
		);
		expect(component.statusCode).toBe(201);
		const version = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/projects/${project.key}/versions`,
			{ name: "2.0" },
		);
		expect(version.statusCode).toBe(201);
		const attachment = await insertAttachment(issue.id, "frozen attachment");

		const [transition] = await db
			.select({ id: workflowTransitions.id })
			.from(workflowTransitions)
			.where(eq(workflowTransitions.workflowId, workflowId))
			.limit(1);

		const archive = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/admin/projects/${project.key}/archive`,
		);
		expect(archive.statusCode).toBe(200);

		const snapshot = async () => ({
			issues: await countRows(issues, eq(issues.projectId, project.id)),
			comments: await countRows(comments, eq(comments.issueId, issue.id)),
			links: await countRows(
				issueLinks,
				eq(issueLinks.sourceIssueId, issue.id),
			),
			components: await countRows(
				components,
				eq(components.projectId, project.id),
			),
			versions: await countRows(versions, eq(versions.projectId, project.id)),
			attachments: await countRows(
				attachments,
				eq(attachments.issueId, issue.id),
			),
			project: (
				await db
					.select({ name: projects.name, key: projects.key })
					.from(projects)
					.where(eq(projects.id, project.id))
			)[0],
		});
		const before = await snapshot();

		const boundary = "----rvna-test";
		const multipart = Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`,
		);

		const writes: {
			label: string;
			method: "POST" | "PATCH" | "PUT" | "DELETE";
			url: string;
			payload?: unknown;
			headers?: Record<string, string>;
		}[] = [
			{
				label: "create issue",
				method: "POST",
				url: "/api/issues",
				payload: {
					project: project.key,
					type: taskTypeId,
					summary: `${tag} refused`,
				},
			},
			{
				label: "update issue",
				method: "PATCH",
				url: `/api/issues/${issue.key}`,
				payload: { summary: `${tag} changed` },
			},
			{
				label: "transition issue",
				method: "POST",
				url: `/api/issues/${issue.key}/transitions`,
				payload: { transitionId: transition.id },
			},
			{
				label: "add comment",
				method: "POST",
				url: `/api/issues/${issue.key}/comments`,
				payload: { body: "refused" },
			},
			{
				label: "edit comment",
				method: "PATCH",
				url: `/api/issues/${issue.key}/comments/${comment.json().id}`,
				payload: { body: "refused" },
			},
			{
				label: "delete comment",
				method: "DELETE",
				url: `/api/issues/${issue.key}/comments/${comment.json().id}`,
			},
			{
				label: "add worklog",
				method: "POST",
				url: `/api/issues/${issue.key}/worklogs`,
				payload: { seconds: 60 },
			},
			{
				label: "delete worklog",
				method: "DELETE",
				url: `/api/issues/${issue.key}/worklogs/${worklog.json().id}`,
			},
			{
				label: "watch issue",
				method: "PUT",
				url: `/api/issues/${issue.key}/watch`,
			},
			{
				label: "unwatch issue",
				method: "DELETE",
				url: `/api/issues/${issue.key}/watch`,
			},
			{
				label: "add link",
				method: "POST",
				url: `/api/issues/${issue.key}/links`,
				payload: {
					typeId: linkTypeId,
					direction: "outward",
					targetKey: otherIssue.key,
				},
			},
			{
				label: "delete link",
				method: "DELETE",
				url: `/api/issue-links/${link.json().id}`,
			},
			{
				label: "upload attachment",
				method: "POST",
				url: `/api/issues/${issue.key}/attachments`,
				payload: multipart,
				headers: {
					"content-type": `multipart/form-data; boundary=${boundary}`,
				},
			},
			{
				label: "delete attachment",
				method: "DELETE",
				url: `/api/attachments/${attachment.id}`,
			},
			{
				label: "add component",
				method: "POST",
				url: `/api/projects/${project.key}/components`,
				payload: { name: "refused component" },
			},
			{
				label: "edit component",
				method: "PATCH",
				url: `/api/components/${component.json().id}`,
				payload: { name: "refused" },
			},
			{
				label: "delete component",
				method: "DELETE",
				url: `/api/components/${component.json().id}`,
			},
			{
				label: "add version",
				method: "POST",
				url: `/api/projects/${project.key}/versions`,
				payload: { name: "refused" },
			},
			{
				label: "edit version",
				method: "PATCH",
				url: `/api/versions/${version.json().id}`,
				payload: { name: "refused" },
			},
			{
				label: "delete version",
				method: "DELETE",
				url: `/api/versions/${version.json().id}`,
			},
			{
				label: "edit project",
				method: "PATCH",
				url: `/api/projects/${project.key}`,
				payload: { name: `${tag} refused` },
			},
			{
				label: "delete issue",
				method: "DELETE",
				url: `/api/issues/${issue.key}`,
			},
		];

		const failures: string[] = [];
		for (const write of writes) {
			const response = await app.inject({
				method: write.method,
				url: write.url,
				cookies: { sid: admin.session },
				headers: {
					"x-requested-with": "rvna",
					...(write.payload !== undefined && !(write.payload instanceof Buffer)
						? { "content-type": "application/json" }
						: {}),
					...write.headers,
				},
				payload: write.payload as never,
			});
			if (response.statusCode !== 403) {
				failures.push(`${write.label} -> ${response.statusCode}`);
				continue;
			}
			const body = response.json() as { error?: string };
			if (body.error !== "This project is archived and read-only") {
				failures.push(`${write.label} -> ${JSON.stringify(body)}`);
			}
		}
		expect(failures).toEqual([]);

		expect(await snapshot()).toEqual(before);

		const reads = [
			`/api/issues/${issue.key}`,
			`/api/issues/${issue.key}/comments`,
			`/api/issues/${issue.key}/worklogs`,
			`/api/issues/${issue.key}/history`,
			`/api/projects/${project.key}`,
			`/api/projects/${project.key}/issues`,
			`/api/attachments/${attachment.id}`,
		];
		for (const url of reads) {
			const response = await injectAs(app, admin.session, "GET", url);
			expect(response.statusCode, url).toBe(200);
		}

		const restore = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/admin/projects/${project.key}/restore`,
		);
		expect(restore.statusCode).toBe(200);

		const allowed = await injectAs(
			app,
			admin.session,
			"POST",
			`/api/issues/${issue.key}/comments`,
			{ body: "allowed again" },
		);
		expect(allowed.statusCode).toBe(201);

		const writable = await injectAs(
			app,
			admin.session,
			"PATCH",
			`/api/projects/${project.key}`,
			{ name: `${tag} thawed` },
		);
		expect(writable.statusCode).toBe(200);
	});

	test("covers every mutating project route", async () => {
		const routes = await allAppRoutes();
		const uncovered = routes
			.filter(
				(route) =>
					mutatingMethods.has(route.method) &&
					!isExemptWriteRoute(route.pattern) &&
					(route.kind === "endpoint" || route.pattern.includes(":key")),
			)
			.filter((route) => writeRouteScopes[routeKey(route)] === undefined)
			.map(routeKey);

		expect(
			uncovered,
			"add the route to writeRouteScopes in src/lib/server/project-keys.ts or exempt it",
		).toEqual([]);

		const known = new Set(routes.map(routeKey));
		const missing = Object.keys(writeRouteScopes).filter(
			(pattern) => !known.has(pattern),
		);
		expect(
			missing,
			"writeRouteScopes names a route that does not exist",
		).toEqual([]);
	});
});

describe("deleting projects", () => {
	test("needs the exact key and removes only unreferenced attachment files", async () => {
		const project = await makeProject("Q", { name: "Doomed" });
		const issue = await createIssue(project.key, "doomed issue");
		await injectAs(
			app,
			admin.session,
			"POST",
			`/api/projects/${project.key}/components`,
			{ name: "Doomed component" },
		);
		const shared = await insertAttachment(
			issue.id,
			"shared content",
			"shared.txt",
		);
		const own = await insertAttachment(issue.id, "own content", "own.txt");

		// Another project keeps an attachment with the same content (same sha256, other file).
		const keeper = await makeProject("R", { name: "Keeper" });
		const keeperIssue = await createIssue(keeper.key, "keeper issue");
		const kept = await insertAttachment(
			keeperIssue.id,
			"shared content",
			"kept.txt",
		);

		const wrong = await injectAs(
			app,
			admin.session,
			"DELETE",
			`/api/admin/projects/${project.key}`,
			{ confirmKey: "WRONG" },
		);
		expect(wrong.statusCode).toBe(400);
		expect(wrong.json().error).toBe("Type the project key to confirm");

		const response = await injectAs(
			app,
			admin.session,
			"DELETE",
			`/api/admin/projects/${project.key}`,
			{ confirmKey: project.key },
		);
		expect(response.statusCode).toBe(204);

		const [gone] = await db
			.select({ id: projects.id })
			.from(projects)
			.where(eq(projects.id, project.id));
		expect(gone).toBeUndefined();
		expect(await countRows(issues, eq(issues.projectId, project.id))).toBe(0);
		expect(
			await countRows(components, eq(components.projectId, project.id)),
		).toBe(0);

		await expect(stat(own.path)).rejects.toThrow();
		await expect(stat(shared.path)).rejects.toThrow();
		expect((await stat(kept.path)).isFile()).toBe(true);

		const audits = await auditRows("project.delete", project.id);
		expect(audits).toHaveLength(1);
		expect(audits[0].changes).toMatchObject({
			from: { key: project.key, issues: 1 },
		});
	});

	test("answers 404 for an unknown project", async () => {
		const response = await injectAs(
			app,
			admin.session,
			"DELETE",
			`/api/admin/projects/${keyFor("Z")}`,
			{ confirmKey: keyFor("Z") },
		);
		expect(response.statusCode).toBe(404);
	});
});

test("non-admins cannot reach the projects API", async () => {
	const response = await injectAs(
		app,
		member.session,
		"GET",
		"/api/admin/projects",
	);
	expect(response.statusCode).toBe(403);
});
