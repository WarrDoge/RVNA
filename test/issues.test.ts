import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
	contentDisposition,
	saveAttachmentUpload,
} from "../src/lib/server/attachments/service.ts";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { HttpError } from "../src/lib/server/http.ts";
import {
	components,
	issueAffectsVersions,
	issueTypes,
	linkTypes,
	permissionGrants,
	permissionSchemes,
	priorities,
	projectIssueTypes,
	projects,
	projectWorkflows,
	resolutions,
	statuses,
	versions,
	workflowStatuses,
	workflows,
	workflowTransitions,
} from "../src/lib/server/schema.ts";
import { makeUser } from "./admin-helpers.ts";
import {
	adminGroup,
	buildServer,
	cleanupTestData,
	grantDefaultProjectRole,
	login,
} from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const tag = `test-${run}`;
const projectKey = `T${run.slice(0, 6).toUpperCase()}`;
const concurrencyKey = `C${run.slice(0, 6).toUpperCase()}`;

let app: TestApp;
let userSession: string;
let otherSession: string;
let adminSession: string;
let viewerSession: string;
let userId: string;
let otherId: string;
let projectId: string;
let concurrencyProjectId: string;
let workflowId: string;
let taskTypeId: string;
let epicTypeId: string;
let subtaskTypeId: string;
let todoStatusId: string;
let inProgressStatusId: string;
let doneStatusId: string;
let mediumPriorityId: string;
let highPriorityId: string;
let fixedResolutionId: string;
let componentId: string;
let versionId: string;
let blocksTypeId: string;
let hiddenProjectId: string | null = null;
let hiddenSchemeId: string | null = null;
const transitionIds: Record<string, string> = {};

const metadataIds: {
	issueTypes: string[];
	statuses: string[];
	priorities: string[];
	resolutions: string[];
	linkTypes: string[];
} = {
	issueTypes: [],
	statuses: [],
	priorities: [],
	resolutions: [],
	linkTypes: [],
};

function inject(
	method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
	url: string,
	session: string | null,
	payload?: unknown,
	headers: Record<string, string> = {},
) {
	return app.inject({
		method,
		url,
		cookies: session ? { sid: session } : undefined,
		headers: {
			...(session ? { "x-requested-with": "rvna" } : {}),
			...headers,
		},
		payload: payload as never,
	});
}

function createIssue(
	session: string,
	body: Record<string, unknown> = {},
	project = projectKey,
) {
	return inject("POST", "/api/issues", session, {
		project,
		type: taskTypeId,
		summary: `Test issue ${randomUUID().slice(0, 8)}`,
		...body,
	});
}

async function projectFixture(key: string, name: string) {
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project:${key}`,
			key,
			name,
			projectType: "software",
			lastIssueNumber: 0,
		})
		.returning();

	await db.insert(projectIssueTypes).values(
		[
			{ typeId: taskTypeId },
			{ typeId: epicTypeId },
			{ typeId: subtaskTypeId },
		].map(({ typeId }) => ({
			sourceId: `${tag}:project-type:${key}:${typeId}`,
			projectId: project.id,
			issueTypeId: typeId,
		})),
	);
	await db.insert(projectWorkflows).values({
		sourceId: `${tag}:project-workflow:${key}`,
		projectId: project.id,
		issueTypeId: null,
		workflowId,
	});

	return project;
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();

	const session = await login(app, {
		sub: `${tag}-user`,
		username: `t-${run}-user`,
		name: "Test User",
		email: `t-${run}-user@example.test`,
		groups: [],
	});
	userSession = session.sessionId as string;

	const other = await login(app, {
		sub: `${tag}-other`,
		username: `t-${run}-other`,
		name: "Other User",
		email: `t-${run}-other@example.test`,
		groups: [],
	});
	otherSession = other.sessionId as string;

	const admin = await login(app, {
		sub: `${tag}-admin`,
		username: `t-${run}-admin`,
		name: "Admin User",
		groups: [adminGroup()],
	});
	adminSession = admin.sessionId as string;

	const viewer = await login(app, {
		sub: `${tag}-viewer`,
		username: `t-${run}-viewer`,
		name: "Viewer User",
		groups: [],
	});
	viewerSession = viewer.sessionId as string;

	const userRows = await pool.query<{ id: string; username: string }>(
		"select id, username from users where username like $1",
		[`t-${run}-%`],
	);
	userId = userRows.rows.find((row) => row.username === `t-${run}-user`)
		?.id as string;
	otherId = userRows.rows.find((row) => row.username === `t-${run}-other`)
		?.id as string;

	const typeRows = await db
		.insert(issueTypes)
		.values([
			{ sourceId: `${tag}:type:task`, name: `${tag} Task`, subtask: false },
			{ sourceId: `${tag}:type:epic`, name: "Epic", subtask: false },
			{
				sourceId: `${tag}:type:subtask`,
				name: `${tag} Sub-task`,
				subtask: true,
			},
		])
		.returning();
	taskTypeId = typeRows[0].id;
	epicTypeId = typeRows[1].id;
	subtaskTypeId = typeRows[2].id;
	metadataIds.issueTypes = typeRows.map((row) => row.id);

	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}:status:todo`, name: `${tag} To Do`, category: "new" },
			{
				sourceId: `${tag}:status:progress`,
				name: `${tag} In Progress`,
				category: "indeterminate",
			},
			{ sourceId: `${tag}:status:done`, name: `${tag} Done`, category: "done" },
		])
		.returning();
	todoStatusId = statusRows[0].id;
	inProgressStatusId = statusRows[1].id;
	doneStatusId = statusRows[2].id;
	metadataIds.statuses = statusRows.map((row) => row.id);

	const priorityRows = await db
		.insert(priorities)
		.values([
			{
				sourceId: `${tag}:priority:medium`,
				name: `${tag} Medium`,
				sequence: 2,
			},
			{ sourceId: `${tag}:priority:high`, name: `${tag} High`, sequence: 1 },
		])
		.returning();
	mediumPriorityId = priorityRows[0].id;
	highPriorityId = priorityRows[1].id;
	metadataIds.priorities = priorityRows.map((row) => row.id);

	const resolutionRows = await db
		.insert(resolutions)
		.values([
			{ sourceId: `${tag}:resolution:fixed`, name: `${tag} Fixed` },
			{ sourceId: `${tag}:resolution:declined`, name: `${tag} Declined` },
		])
		.returning();
	fixedResolutionId = resolutionRows[0].id;
	metadataIds.resolutions = resolutionRows.map((row) => row.id);

	const [linkType] = await db
		.insert(linkTypes)
		.values({
			sourceId: `${tag}:link-type`,
			name: `${tag} Blocks`,
			inward: `${tag} is blocked by`,
			outward: `${tag} blocks`,
		})
		.returning();
	blocksTypeId = linkType.id;
	const [cloners] = await db
		.insert(linkTypes)
		.values({
			sourceId: `${tag}:cloners`,
			name: "Cloners",
			inward: "is cloned by",
			outward: "clones",
		})
		.returning();
	metadataIds.linkTypes = [linkType.id, cloners.id];

	const [workflow] = await db
		.insert(workflows)
		.values({ sourceId: `${tag}:workflow`, name: `${tag} workflow` })
		.returning();
	workflowId = workflow.id;

	await db.insert(workflowStatuses).values(
		statusRows.map((status) => ({
			sourceId: `${tag}:workflow-status:${status.id}`,
			workflowId,
			statusId: status.id,
		})),
	);

	const transitions = await db
		.insert(workflowTransitions)
		.values([
			{
				sourceId: `${tag}:transition:start`,
				workflowId,
				name: "Start progress",
				fromStatusId: todoStatusId,
				toStatusId: inProgressStatusId,
				sequence: 0,
			},
			{
				sourceId: `${tag}:transition:finish`,
				workflowId,
				name: "Finish",
				fromStatusId: inProgressStatusId,
				toStatusId: doneStatusId,
				sequence: 1,
			},
			{
				sourceId: `${tag}:transition:mark-done`,
				workflowId,
				name: "Mark done",
				fromStatusId: todoStatusId,
				toStatusId: doneStatusId,
				sequence: 2,
			},
			{
				sourceId: `${tag}:transition:stop`,
				workflowId,
				name: "Stop progress",
				fromStatusId: inProgressStatusId,
				toStatusId: todoStatusId,
				sequence: 3,
			},
			{
				sourceId: `${tag}:transition:reopen`,
				workflowId,
				name: "Reopen",
				fromStatusId: doneStatusId,
				toStatusId: inProgressStatusId,
				sequence: 4,
			},
		])
		.returning();
	for (const transition of transitions) {
		transitionIds[transition.name] = transition.id;
	}

	const project = await projectFixture(projectKey, `${tag} Project`);
	projectId = project.id;
	const concurrencyProject = await projectFixture(
		concurrencyKey,
		`${tag} Concurrency`,
	);
	concurrencyProjectId = concurrencyProject.id;
	await grantDefaultProjectRole(projectId, [`t-${run}-user`, `t-${run}-other`]);
	await grantDefaultProjectRole(concurrencyProjectId, [`t-${run}-user`]);

	const [component] = await db
		.insert(components)
		.values({
			sourceId: `${tag}:component`,
			projectId,
			name: "Backend",
		})
		.returning();
	componentId = component.id;

	const [version] = await db
		.insert(versions)
		.values({
			sourceId: `${tag}:version`,
			projectId,
			name: "1.0",
			sequence: 0,
		})
		.returning();
	versionId = version.id;
});

afterAll(async () => {
	if (hiddenSchemeId) {
		await pool.query("delete from permission_schemes where id = $1", [
			hiddenSchemeId,
		]);
	}
	if (hiddenProjectId) {
		await pool.query("delete from projects where id = $1", [hiddenProjectId]);
	}
	await pool.query("delete from projects where id = any($1::uuid[])", [
		[projectId, concurrencyProjectId],
	]);
	await pool.query("delete from workflows where id = any($1::uuid[])", [
		[workflowId],
	]);
	await pool.query("delete from issue_types where id = any($1::uuid[])", [
		metadataIds.issueTypes,
	]);
	await pool.query("delete from statuses where id = any($1::uuid[])", [
		metadataIds.statuses,
	]);
	await pool.query("delete from priorities where id = any($1::uuid[])", [
		metadataIds.priorities,
	]);
	await pool.query("delete from resolutions where id = any($1::uuid[])", [
		metadataIds.resolutions,
	]);
	await pool.query("delete from link_types where id = any($1::uuid[])", [
		metadataIds.linkTypes,
	]);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("unauthenticated requests are rejected", async () => {
	expect((await inject("GET", "/api/projects", null)).statusCode).toBe(401);
	expect(
		(await inject("GET", `/api/projects/${projectKey}`, null)).statusCode,
	).toBe(401);
	expect((await inject("GET", "/api/issues/DEMO-343", null)).statusCode).toBe(
		401,
	);
	expect(
		(await inject("POST", "/api/issues", null, { summary: "No session" }))
			.statusCode,
	).toBe(401);
});

test("projects list and detail expose the workflow statuses", async () => {
	const list = await inject("GET", "/api/projects", userSession);
	expect(list.statusCode).toBe(200);
	const project = list
		.json()
		.find((item: { key: string }) => item.key === projectKey);
	expect(project).toMatchObject({
		key: projectKey,
		name: `${tag} Project`,
		type: "software",
	});
	expect(project.issueCount).toBeGreaterThanOrEqual(0);

	const detail = await inject(
		"GET",
		`/api/projects/${projectKey}`,
		userSession,
	);
	expect(detail.statusCode).toBe(200);
	const body = detail.json();
	expect(body.components.map((item: { name: string }) => item.name)).toContain(
		"Backend",
	);
	expect(body.versions.map((item: { name: string }) => item.name)).toContain(
		"1.0",
	);
	const task = body.issueTypes.find(
		(item: { id: string }) => item.id === taskTypeId,
	);
	expect(task.workflow.statuses).toHaveLength(3);
	expect(
		task.workflow.statuses.map((status: { name: string }) => status.name),
	).toContain(`${tag} Done`);

	const users = await inject(
		"GET",
		`/api/users?query=${encodeURIComponent(`t-${run}-user`)}`,
		userSession,
	);
	expect(users.statusCode).toBe(200);
	expect(users.json()[0]).toMatchObject({
		id: userId,
		username: `t-${run}-user`,
	});
});

test("20 concurrent creates allocate sequential keys", async () => {
	const before = await pool.query<{ last_issue_number: number }>(
		"select last_issue_number from projects where id = $1",
		[concurrencyProjectId],
	);
	const start = before.rows[0].last_issue_number;

	const responses = await Promise.all(
		Array.from({ length: 20 }, (_, index) =>
			createIssue(
				userSession,
				{ summary: `Concurrent ${index}` },
				concurrencyKey,
			),
		),
	);

	for (const response of responses) {
		expect(response.statusCode).toBe(201);
	}

	const numbers = responses
		.map((response) => response.json().number as number)
		.sort((left, right) => left - right);
	expect(new Set(numbers).size).toBe(20);
	expect(numbers).toEqual(
		Array.from({ length: 20 }, (_, index) => start + index + 1),
	);

	const keys = new Set(
		responses.map((response) => response.json().key as string),
	);
	expect(keys.size).toBe(20);

	const after = await pool.query<{ last_issue_number: number }>(
		"select last_issue_number from projects where id = $1",
		[concurrencyProjectId],
	);
	expect(after.rows[0].last_issue_number).toBe(start + 20);
});

test("create sets the initial status, reporter and sanitized description", async () => {
	const response = await createIssue(userSession, {
		summary: "Sanitized create",
		description:
			'<p>Hello<script>alert("x")</script><img src="x" onerror="alert(1)"></p>',
		labels: ["one", "two", "one"],
		components: [componentId],
		fixVersions: [versionId],
		priority: mediumPriorityId,
	});
	expect(response.statusCode).toBe(201);
	const issue = response.json();
	expect(issue.status.name).toBe(`${tag} To Do`);
	expect(issue.reporter.id).toBe(userId);
	expect(issue.assignee).toBeNull();
	expect(issue.descriptionHtml).toContain("Hello");
	expect(issue.descriptionHtml).not.toContain("<script");
	expect(issue.descriptionHtml).not.toContain("onerror");
	expect(issue.labels).toEqual(["one", "two"]);
	expect(issue.components.map((item: { name: string }) => item.name)).toEqual([
		"Backend",
	]);
	expect(issue.fixVersions.map((item: { name: string }) => item.name)).toEqual([
		"1.0",
	]);
	expect(issue.transitions.map((item: { name: string }) => item.name)).toEqual([
		"Start progress",
		"Mark done",
	]);
});

test("a stored link that opens a new window cannot reach its opener", async () => {
	const issue = (
		await createIssue(userSession, {
			summary: "Link rel",
			description:
				'<p><a href="https://example.test/a" target="_blank" rel="opener">a</a> <a href="https://example.test/b" rel="nofollow">b</a></p>',
		})
	).json();
	expect(issue.descriptionHtml).toContain(
		'target="_blank" rel="noopener noreferrer"',
	);
	expect(issue.descriptionHtml).not.toContain('rel="opener"');
	expect(issue.descriptionHtml).toContain('rel="nofollow"');
});

test("transitions reject a wrong start status and manage the resolution", async () => {
	const created = await createIssue(userSession);
	expect(created.statusCode).toBe(201);
	const key = created.json().key as string;

	const wrong = await inject(
		"POST",
		`/api/issues/${key}/transitions`,
		userSession,
		{ transitionId: transitionIds.Finish },
	);
	expect(wrong.statusCode).toBe(400);

	const done = await inject(
		"POST",
		`/api/issues/${key}/transitions`,
		userSession,
		{ transitionId: transitionIds["Mark done"] },
	);
	expect(done.statusCode).toBe(200);
	expect(done.json().status.name).toBe(`${tag} Done`);
	expect(done.json().resolution.name).toBe("Done");
	expect(done.json().resolved).toEqual(expect.any(String));

	const history = await inject(
		"GET",
		`/api/issues/${key}/history`,
		userSession,
	);
	const items = history.json().flatMap(
		(entry: {
			items: {
				field: string;
				fromText: string | null;
				toText: string | null;
			}[];
		}) => entry.items,
	);
	expect(items).toContainEqual({
		field: "status",
		fieldType: "jira",
		from: todoStatusId,
		fromText: `${tag} To Do`,
		to: doneStatusId,
		toText: `${tag} Done`,
	});
	expect(items).toContainEqual({
		field: "resolution",
		fieldType: "jira",
		from: null,
		fromText: null,
		to: done.json().resolution.id,
		toText: "Done",
	});

	const reopened = await inject(
		"POST",
		`/api/issues/${key}/transitions`,
		userSession,
		{ transitionId: transitionIds.Reopen },
	);
	expect(reopened.statusCode).toBe(200);
	expect(reopened.json().status.name).toBe(`${tag} In Progress`);
	expect(reopened.json().resolution).toBeNull();
	expect(reopened.json().resolved).toBeNull();

	const explicit = await createIssue(userSession);
	const explicitKey = explicit.json().key as string;
	const withResolution = await inject(
		"POST",
		`/api/issues/${explicitKey}/transitions`,
		userSession,
		{
			transitionId: transitionIds["Mark done"],
			resolutionId: fixedResolutionId,
		},
	);
	expect(withResolution.statusCode).toBe(200);
	expect(withResolution.json().resolution.name).toBe(`${tag} Fixed`);
});

test("PATCH writes one history entry per changed field", async () => {
	const epic = await createIssue(userSession, {
		type: epicTypeId,
		summary: "Epic for patch",
	});
	expect(epic.statusCode).toBe(201);
	const epicKey = epic.json().key as string;

	const created = await createIssue(userSession, {
		summary: "Before patch",
		priority: mediumPriorityId,
		labels: ["alpha"],
		components: [componentId],
		fixVersions: [versionId],
	});
	expect(created.statusCode).toBe(201);
	const key = created.json().key as string;

	const patched = await inject("PATCH", `/api/issues/${key}`, userSession, {
		summary: "After patch",
		description: "<p>New description</p>",
		priority: highPriorityId,
		assignee: otherId,
		labels: ["alpha", "beta"],
		components: [],
		fixVersions: [versionId],
		dueDate: "2026-12-31",
		storyPoints: 5,
		originalEstimate: 3600,
		remainingEstimate: 1800,
		epic: epicKey,
	});
	expect(patched.statusCode).toBe(200);
	const issue = patched.json();
	expect(issue.summary).toBe("After patch");
	expect(issue.priority.name).toBe(`${tag} High`);
	expect(issue.assignee.id).toBe(otherId);
	expect(issue.labels).toEqual(["alpha", "beta"]);
	expect(issue.components).toEqual([]);
	expect(issue.fixVersions.map((item: { name: string }) => item.name)).toEqual([
		"1.0",
	]);
	expect(issue.dueDate).toBe("2026-12-31");
	expect(issue.storyPoints).toBe(5);
	expect(issue.timeTracking).toMatchObject({
		originalEstimate: 3600,
		remainingEstimate: 1800,
	});
	expect(issue.epic.key).toBe(epicKey);

	const history = await inject(
		"GET",
		`/api/issues/${key}/history`,
		userSession,
	);
	expect(history.statusCode).toBe(200);
	const entry = history
		.json()
		.find((item: { items: unknown[] }) => item.items.length > 0);
	expect(entry.author.id).toBe(userId);
	const fields = entry.items.map((item: { field: string }) => item.field);
	expect(fields).toEqual(
		expect.arrayContaining([
			"summary",
			"description",
			"priority",
			"assignee",
			"labels",
			"Component",
			"duedate",
			"Story Points",
			"timeoriginalestimate",
			"timeestimate",
			"Epic Link",
		]),
	);
	expect(fields).not.toContain("Fix Version");

	const componentItem = entry.items.find(
		(item: { field: string }) => item.field === "Component",
	);
	expect(componentItem).toMatchObject({
		fromText: "Backend",
		toText: "",
	});

	const epicItem = entry.items.find(
		(item: { field: string }) => item.field === "Epic Link",
	);
	expect(epicItem).toMatchObject({ fromText: null, toText: epicKey });
});

test("comments are sanitized and only the author or an admin may change them", async () => {
	const created = await createIssue(userSession);
	const key = created.json().key as string;

	const comment = await inject(
		"POST",
		`/api/issues/${key}/comments`,
		userSession,
		{
			body: '<p>Hello<script>alert("x")</script><img src="x" onerror="alert(1)"></p>',
		},
	);
	expect(comment.statusCode).toBe(201);
	const commentId = comment.json().id as string;
	expect(comment.json().bodyHtml).not.toContain("<script");
	expect(comment.json().bodyHtml).not.toContain("onerror");

	const otherComment = await inject(
		"POST",
		`/api/issues/${key}/comments`,
		otherSession,
		{ body: "<p>Other author</p>" },
	);
	expect(otherComment.statusCode).toBe(201);
	const otherCommentId = otherComment.json().id as string;

	const forbidden = await inject(
		"PATCH",
		`/api/issues/${key}/comments/${otherCommentId}`,
		userSession,
		{ body: "<p>Not mine</p>" },
	);
	expect(forbidden.statusCode).toBe(403);

	const adminEdit = await inject(
		"PATCH",
		`/api/issues/${key}/comments/${otherCommentId}`,
		adminSession,
		{ body: "<p>Admin edit</p>" },
	);
	expect(adminEdit.statusCode).toBe(200);
	expect(adminEdit.json().bodyHtml).toContain("Admin edit");

	const authorEdit = await inject(
		"PATCH",
		`/api/issues/${key}/comments/${commentId}`,
		userSession,
		{ body: "<p>Edited</p><script>bad()</script>" },
	);
	expect(authorEdit.statusCode).toBe(200);
	expect(authorEdit.json().bodyHtml).toContain("Edited");
	expect(authorEdit.json().bodyHtml).not.toContain("<script");

	const authorDelete = await inject(
		"DELETE",
		`/api/issues/${key}/comments/${commentId}`,
		userSession,
	);
	expect(authorDelete.statusCode).toBe(204);

	const adminDelete = await inject(
		"DELETE",
		`/api/issues/${key}/comments/${otherCommentId}`,
		adminSession,
	);
	expect(adminDelete.statusCode).toBe(204);

	const listed = await inject(
		"GET",
		`/api/issues/${key}/comments`,
		userSession,
	);
	expect(listed.statusCode).toBe(200);
	expect(listed.json()).toEqual([]);

	const empty = await inject(
		"POST",
		`/api/issues/${key}/comments`,
		userSession,
		{ body: "<script></script>" },
	);
	expect(empty.statusCode).toBe(400);
});

function multipartBody(file: { name: string; type: string; content: string }) {
	const boundary = `----rvna${randomUUID()}`;
	const head = Buffer.from(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
	);
	const body = Buffer.concat([
		head,
		Buffer.from(file.content),
		Buffer.from(`\r\n--${boundary}--\r\n`),
	]);
	return {
		body,
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

test("worklogs update time tracking and watchers can be toggled", async () => {
	const created = await createIssue(userSession, { summary: "Time tracking" });
	const key = created.json().key as string;

	const prepared = await inject("PATCH", `/api/issues/${key}`, userSession, {
		originalEstimate: 7200,
		remainingEstimate: 7200,
	});
	expect(prepared.statusCode).toBe(200);

	const logged = await inject(
		"POST",
		`/api/issues/${key}/worklogs`,
		userSession,
		{ seconds: 3600, comment: "Worked on it" },
	);
	expect(logged.statusCode).toBe(201);
	const worklogId = logged.json().id as string;

	const afterLog = await inject("GET", `/api/issues/${key}`, userSession);
	expect(afterLog.json().timeTracking).toMatchObject({
		originalEstimate: 7200,
		remainingEstimate: 3600,
		timeSpent: 3600,
	});

	const listed = await inject(
		"GET",
		`/api/issues/${key}/worklogs`,
		userSession,
	);
	expect(listed.json()).toHaveLength(1);
	expect(listed.json()[0]).toMatchObject({
		seconds: 3600,
		comment: "Worked on it",
	});

	const forbidden = await inject(
		"DELETE",
		`/api/issues/${key}/worklogs/${worklogId}`,
		otherSession,
	);
	expect(forbidden.statusCode).toBe(403);

	const deleted = await inject(
		"DELETE",
		`/api/issues/${key}/worklogs/${worklogId}`,
		userSession,
	);
	expect(deleted.statusCode).toBe(204);

	const afterDelete = await inject("GET", `/api/issues/${key}`, userSession);
	expect(afterDelete.json().timeTracking).toMatchObject({
		remainingEstimate: 7200,
		timeSpent: 0,
	});

	const watched = await inject("PUT", `/api/issues/${key}/watch`, userSession);
	expect(watched.statusCode).toBe(200);
	expect(watched.json()).toEqual({ count: 1, watching: true });

	const unwatched = await inject(
		"DELETE",
		`/api/issues/${key}/watch`,
		userSession,
	);
	expect(unwatched.statusCode).toBe(200);
	expect(unwatched.json()).toEqual({ count: 0, watching: false });
});

test("the attachment function checks permission and the file cap itself", async () => {
	const created = await createIssue(userSession);
	const key = created.json().key as string;
	const file = {
		field: "file",
		path: join(tmpdir(), `missing-${run}`),
		fileName: "a.txt",
		mimeType: "text/plain",
		size: 1,
	};
	const [viewerRow] = await pool
		.query<{ id: string }>("select id from users where username = $1", [
			`t-${run}-viewer`,
		])
		.then((result) => result.rows);
	const actor = (id: string, username: string): CurrentUser => ({
		id,
		username,
		displayName: username,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	});
	const refusal = (who: CurrentUser, files: (typeof file)[]) =>
		saveAttachmentUpload(who, key, { fields: {}, files }).then(
			() => null,
			(caught: unknown) => caught as HttpError,
		);

	const viewer = await refusal(actor(viewerRow.id, `t-${run}-viewer`), [file]);
	expect(viewer).toBeInstanceOf(HttpError);
	expect(viewer?.status).toBe(403);

	const tooMany = await refusal(
		actor(userId, `t-${run}-user`),
		Array.from({ length: 21 }, () => ({ ...file })),
	);
	expect(tooMany?.status).toBe(413);
	expect(tooMany?.details).toMatchObject({ code: "FST_FILES_LIMIT" });
});

test("attachments round trip, are served safely and can be deleted", async () => {
	const created = await createIssue(userSession);
	const key = created.json().key as string;

	const text = multipartBody({
		name: "notes.txt",
		type: "text/plain",
		content: "attachment body",
	});
	const upload = await inject(
		"POST",
		`/api/issues/${key}/attachments`,
		userSession,
		text.body,
		{ "content-type": text.contentType },
	);
	expect(upload.statusCode).toBe(201);
	const attachment = upload.json()[0];
	expect(attachment).toMatchObject({
		fileName: "notes.txt",
		mimeType: "text/plain",
		size: 15,
	});
	expect(attachment.author.id).toBe(userId);

	const download = await inject(
		"GET",
		`/api/attachments/${attachment.id}`,
		userSession,
	);
	expect(download.statusCode).toBe(200);
	expect(download.body).toBe("attachment body");
	expect(download.headers["content-type"]).toBe("text/plain");
	expect(download.headers["x-content-type-options"]).toBe("nosniff");
	expect(download.headers["content-security-policy"]).toBe("sandbox");
	expect(String(download.headers["content-disposition"])).toMatch(/^inline;/);

	const html = multipartBody({
		name: "page.html",
		type: "text/html",
		content: "<script>alert(1)</script>",
	});
	const htmlUpload = await inject(
		"POST",
		`/api/issues/${key}/attachments`,
		userSession,
		html.body,
		{ "content-type": html.contentType },
	);
	expect(htmlUpload.statusCode).toBe(201);
	const htmlId = htmlUpload.json()[0].id as string;

	const htmlDownload = await inject(
		"GET",
		`/api/attachments/${htmlId}`,
		userSession,
	);
	expect(htmlDownload.statusCode).toBe(200);
	expect(String(htmlDownload.headers["content-disposition"])).toMatch(
		/^attachment;/,
	);
	expect(htmlDownload.headers["x-content-type-options"]).toBe("nosniff");
	expect(htmlDownload.headers["content-security-policy"]).toBe("sandbox");

	const svg = multipartBody({
		name: "diagram.svg",
		type: "image/svg+xml",
		content:
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
	});
	const svgUpload = await inject(
		"POST",
		`/api/issues/${key}/attachments`,
		userSession,
		svg.body,
		{ "content-type": svg.contentType },
	);
	expect(svgUpload.statusCode).toBe(201);
	const svgId = svgUpload.json()[0].id as string;
	const svgDownload = await inject(
		"GET",
		`/api/attachments/${svgId}`,
		userSession,
	);
	expect(svgDownload.statusCode).toBe(200);
	expect(String(svgDownload.headers["content-disposition"])).toMatch(
		/^attachment;/,
	);

	const importedId = `imported-${run}`;
	await pool.query("update attachments set source_id = $1 where id = $2", [
		importedId,
		attachment.id,
	]);
	const bySourceId = await inject(
		"GET",
		`/api/attachments/${importedId}`,
		userSession,
	);
	expect(bySourceId.statusCode).toBe(200);
	expect(bySourceId.body).toBe("attachment body");

	const forbidden = await inject(
		"DELETE",
		`/api/attachments/${htmlId}`,
		otherSession,
	);
	expect(forbidden.statusCode).toBe(403);

	const deleted = await inject(
		"DELETE",
		`/api/attachments/${htmlId}`,
		userSession,
	);
	expect(deleted.statusCode).toBe(204);
	expect(
		(await inject("GET", `/api/attachments/${htmlId}`, userSession)).statusCode,
	).toBe(404);

	const unauthenticated = await inject(
		"GET",
		`/api/attachments/${attachment.id}`,
		null,
	);
	expect(unauthenticated.statusCode).toBe(401);
});

test.each([
	["application/javascript", "script.js"],
	["text/javascript; charset=utf-8", "script.mjs"],
	["Application/X-Javascript", "old.js"],
	["text/html", "page.html"],
	["image/svg+xml", "diagram.svg"],
	["text/css", "style.css"],
	["application/xml", "data.xml"],
	["application/xhtml+xml", "page.xhtml"],
	["text/csv", "table.csv"],
	["application/octet-stream", "blob.bin"],
])(
	"an attachment declared as %j is served as an octet stream download",
	async (declared, name) => {
		const key = (await createIssue(userSession)).json().key as string;
		const file = multipartBody({
			name,
			type: declared,
			content: "window.__ran = 1",
		});
		const upload = await inject(
			"POST",
			`/api/issues/${key}/attachments`,
			userSession,
			file.body,
			{ "content-type": file.contentType },
		);
		expect(upload.statusCode).toBe(201);
		const download = await inject(
			"GET",
			`/api/attachments/${upload.json()[0].id}`,
			userSession,
		);
		expect(download.statusCode).toBe(200);
		expect(download.headers["content-type"]).toBe("application/octet-stream");
		expect(download.headers["x-content-type-options"]).toBe("nosniff");
		expect(download.headers["content-security-policy"]).toBe("sandbox");
		expect(String(download.headers["content-disposition"])).toMatch(
			/^attachment;/,
		);
	},
);

test.each([
	["text/plain; charset=utf-8", "text/plain"],
	["image/PNG", "image/png"],
	["application/pdf", "application/pdf"],
	["video/mp4", "video/mp4"],
	["audio/mpeg", "audio/mpeg"],
])("an attachment declared as %j is shown as %s", async (declared, served) => {
	const key = (await createIssue(userSession)).json().key as string;
	const file = multipartBody({
		name: "file.bin",
		type: declared,
		content: "x",
	});
	const upload = await inject(
		"POST",
		`/api/issues/${key}/attachments`,
		userSession,
		file.body,
		{ "content-type": file.contentType },
	);
	const download = await inject(
		"GET",
		`/api/attachments/${upload.json()[0].id}`,
		userSession,
	);
	expect(download.headers["content-type"]).toBe(served);
	expect(download.headers["x-content-type-options"]).toBe("nosniff");
	expect(String(download.headers["content-disposition"])).toMatch(/^inline;/);
});

test("the RFC 5987 filename escapes characters attr-char does not allow", () => {
	expect(contentDisposition("attachment", "O'Brien (1)*.txt")).toBe(
		`attachment; filename="O'Brien (1)*.txt"; filename*=UTF-8''O%27Brien%20%281%29%2A.txt`,
	);
});

test("an author with Delete all attachments may delete their own", async () => {
	const key = `D${run.slice(0, 6).toUpperCase()}`;
	const project = await projectFixture(key, `${tag} Delete all`);
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `${tag}:delete-all-scheme`,
			name: `${tag} delete all scheme`,
			projectIds: [project.id],
			raw: {},
		})
		.returning();
	await db.insert(permissionGrants).values(
		(
			[
				["BROWSE_PROJECTS", "anyone", null],
				["CREATE_ISSUES", "projectRole", "member"],
				["CREATE_ATTACHMENTS", "projectRole", "member"],
				["DELETE_ALL_ATTACHMENTS", "projectRole", "member"],
			] as const
		).map(([permissionKey, holderType, holderParameter]) => ({
			sourceId: `${tag}:delete-all-${permissionKey}`,
			schemeId: scheme.id,
			permissionKey,
			holderType,
			holderParameter,
			raw: {},
		})),
	);
	await grantDefaultProjectRole(project.id, [`t-${run}-user`], "member");
	try {
		const created = await createIssue(
			userSession,
			{ summary: "Delete all own attachment" },
			key,
		);
		expect(created.statusCode).toBe(201);
		const issueKey = created.json().key as string;
		const text = multipartBody({
			name: "own.txt",
			type: "text/plain",
			content: "own attachment",
		});
		const upload = await inject(
			"POST",
			`/api/issues/${issueKey}/attachments`,
			userSession,
			text.body,
			{ "content-type": text.contentType },
		);
		expect(upload.statusCode).toBe(201);
		const attachmentId = upload.json()[0].id as string;
		const deleted = await inject(
			"DELETE",
			`/api/attachments/${attachmentId}`,
			userSession,
		);
		expect(deleted.statusCode).toBe(204);
	} finally {
		await pool.query("delete from issues where project_id = $1", [project.id]);
		await pool.query("delete from permission_schemes where id = $1", [
			scheme.id,
		]);
		await pool.query("delete from projects where id = $1", [project.id]);
	}
});

test("deleting an issue leaves an audit record that names the actor", async () => {
	const created = (
		await createIssue(userSession, { summary: "Delete with audit" })
	).json();

	const deleted = await inject(
		"DELETE",
		`/api/issues/${created.key}`,
		adminSession,
	);
	expect(deleted.statusCode).toBe(204);
	expect(
		(await inject("GET", `/api/issues/${created.key}`, adminSession))
			.statusCode,
	).toBe(404);

	const audit = await pool.query(
		"delete from audit_log where action = 'issue.delete' and entity_id = $1 returning actor_name, summary",
		[created.id],
	);
	expect(audit.rows).toHaveLength(1);
	expect(audit.rows[0].actor_name).toBe("Admin User");
	expect(audit.rows[0].summary).toContain(created.key);
});

test("project settings are admin-only and components and versions can be managed", async () => {
	const forbidden = await inject(
		"PATCH",
		`/api/projects/${projectKey}`,
		userSession,
		{ name: "Not allowed" },
	);
	expect(forbidden.statusCode).toBe(403);

	const renamed = await inject(
		"PATCH",
		`/api/projects/${projectKey}`,
		adminSession,
		{ name: `${tag} Renamed`, leadId: userId },
	);
	expect(renamed.statusCode).toBe(200);
	expect(renamed.json().name).toBe(`${tag} Renamed`);
	expect(renamed.json().lead.id).toBe(userId);

	const component = await inject(
		"POST",
		`/api/projects/${projectKey}/components`,
		adminSession,
		{ name: "Frontend", description: "UI" },
	);
	expect(component.statusCode).toBe(201);
	const componentId = component.json().id as string;

	const updatedComponent = await inject(
		"PATCH",
		`/api/components/${componentId}`,
		adminSession,
		{ name: "Frontend 2" },
	);
	expect(updatedComponent.statusCode).toBe(200);
	expect(updatedComponent.json().name).toBe("Frontend 2");
	expect(
		(await inject("DELETE", `/api/components/${componentId}`, userSession))
			.statusCode,
	).toBe(403);
	expect(
		(await inject("DELETE", `/api/components/${componentId}`, adminSession))
			.statusCode,
	).toBe(204);

	const version = await inject(
		"POST",
		`/api/projects/${projectKey}/versions`,
		adminSession,
		{ name: "2.0", releaseDate: "2027-01-15" },
	);
	expect(version.statusCode).toBe(201);
	const versionId = version.json().id as string;
	const updatedVersion = await inject(
		"PATCH",
		`/api/versions/${versionId}`,
		adminSession,
		{ released: true },
	);
	expect(updatedVersion.statusCode).toBe(200);
	expect(updatedVersion.json().released).toBe(true);
	expect(
		(await inject("DELETE", `/api/versions/${versionId}`, adminSession))
			.statusCode,
	).toBe(204);
});

test("issue links are grouped by type and direction and can be deleted", async () => {
	const source = await createIssue(userSession, { summary: "Link source" });
	const target = await createIssue(userSession, { summary: "Link target" });
	const sourceKey = source.json().key as string;
	const targetKey = target.json().key as string;

	const created = await inject(
		"POST",
		`/api/issues/${sourceKey}/links`,
		userSession,
		{ typeId: blocksTypeId, targetKey, direction: "outward" },
	);
	expect(created.statusCode).toBe(201);
	expect(created.json().issue.key).toBe(targetKey);

	const detail = await inject("GET", `/api/issues/${sourceKey}`, userSession);
	const group = detail
		.json()
		.links.find(
			(item: { type: { id: string }; direction: string }) =>
				item.type.id === blocksTypeId && item.direction === "outward",
		);
	expect(group.links).toHaveLength(1);
	expect(group.links[0].issue.key).toBe(targetKey);

	const targetDetail = await inject(
		"GET",
		`/api/issues/${targetKey}`,
		userSession,
	);
	expect(targetDetail.json().links[0].direction).toBe("inward");

	const deleted = await inject(
		"DELETE",
		`/api/issue-links/${created.json().id}`,
		userSession,
	);
	expect(deleted.statusCode).toBe(204);

	const after = await inject("GET", `/api/issues/${sourceKey}`, userSession);
	expect(after.json().links).toEqual([]);
});

test("the project issue list is ordered by created and paginates", async () => {
	const first = await createIssue(userSession, { summary: "List first" });
	await new Promise((resolve) => setTimeout(resolve, 5));
	const second = await createIssue(userSession, { summary: "List second" });
	expect(first.statusCode).toBe(201);
	expect(second.statusCode).toBe(201);

	const page = await inject(
		"GET",
		`/api/projects/${projectKey}/issues?offset=0&limit=2`,
		userSession,
	);
	expect(page.statusCode).toBe(200);
	const body = page.json();
	expect(body.limit).toBe(2);
	expect(body.total).toBeGreaterThanOrEqual(2);
	expect(body.issues).toHaveLength(2);
	expect(body.issues[0].key).toBe(second.json().key);
	expect(body.issues[1].key).toBe(first.json().key);
});

test("clone copies the issue fields, reports the caller and links with Cloners", async () => {
	const epic = await createIssue(userSession, {
		summary: `Clone epic ${run}`,
		type: epicTypeId,
	});
	const epicKey = epic.json().key as string;
	const source = await createIssue(userSession, {
		summary: `Clone source ${run}`,
		description: "<p>Clone description</p>",
		priority: highPriorityId,
		assignee: otherId,
		labels: ["clone-a", "clone-b"],
		components: [componentId],
		fixVersions: [versionId],
		epic: epicKey,
	});
	expect(source.statusCode).toBe(201);
	const sourceKey = source.json().key as string;
	const sourceId = source.json().id as string;

	const patched = await inject(
		"PATCH",
		`/api/issues/${sourceKey}`,
		userSession,
		{
			storyPoints: 8,
		},
	);
	expect(patched.statusCode).toBe(200);
	await db.insert(issueAffectsVersions).values({
		sourceId: `${tag}:affects:${sourceId}`,
		issueId: sourceId,
		versionId,
	});
	await pool.query("update issues set custom = $1::jsonb where id = $2", [
		JSON.stringify({ [`${tag}:custom`]: "copied" }),
		sourceId,
	]);
	await inject("POST", `/api/issues/${sourceKey}/comments`, userSession, {
		body: "not copied",
	});
	await pool.query(
		"insert into watchers (source_id, issue_id, user_id) values ($1, $2, $3)",
		[`${tag}:watcher:${sourceId}`, sourceId, otherId],
	);

	const cloned = await inject(
		"POST",
		`/api/issues/${sourceKey}/clone`,
		userSession,
		{
			summary: `Clone result ${run}`,
		},
	);
	expect(cloned.statusCode).toBe(201);
	const detail = cloned.json();
	expect(detail).toMatchObject({
		summary: `Clone result ${run}`,
		descriptionHtml: "<p>Clone description</p>",
		project: { id: projectId },
		type: { id: taskTypeId },
		status: { id: todoStatusId },
		priority: { id: highPriorityId },
		assignee: { id: otherId },
		reporter: { id: userId },
		epic: { key: epicKey },
		storyPoints: 8,
	});
	expect(detail.key).not.toBe(sourceKey);
	expect(detail.labels.sort()).toEqual(["clone-a", "clone-b"]);
	expect(detail.components.map((item: { id: string }) => item.id)).toEqual([
		componentId,
	]);
	expect(detail.fixVersions.map((item: { id: string }) => item.id)).toEqual([
		versionId,
	]);
	expect(detail.affectsVersions.map((item: { id: string }) => item.id)).toEqual(
		[versionId],
	);
	expect(detail.comments).toBeUndefined();
	const cloners = detail.links.find(
		(link: { type: { name: string } }) => link.type.name === "Cloners",
	);
	expect(cloners).toMatchObject({ direction: "outward" });
	expect(cloners.links[0].issue.key).toBe(sourceKey);

	const [row] = await pool
		.query<{ custom: Record<string, unknown>; rank: string | null }>(
			"select custom, rank from issues where id = $1",
			[detail.id],
		)
		.then((result) => [result.rows[0]]);
	expect(row.custom).toEqual({ [`${tag}:custom`]: "copied" });
	expect(row.rank).toBeNull();
	const counts = await pool.query<{
		comments: string;
		worklogs: string;
		attachments: string;
	}>(
		`select
		 (select count(*) from comments where issue_id = $1) as comments,
		 (select count(*) from worklogs where issue_id = $1) as worklogs,
		 (select count(*) from attachments where issue_id = $1) as attachments`,
		[detail.id],
	);
	expect(counts.rows[0]).toEqual({
		comments: "0",
		worklogs: "0",
		attachments: "0",
	});
	const watchers = await pool.query<{ user_id: string }>(
		"select user_id from watchers where issue_id = $1",
		[detail.id],
	);
	expect(watchers.rows.map((row) => row.user_id)).not.toContain(otherId);
});

test("clone defaults the summary and keeps a sub-task parent", async () => {
	const parent = await createIssue(userSession, {
		summary: `Clone parent ${run}`,
	});
	const parentKey = parent.json().key as string;
	const subtask = await createIssue(userSession, {
		summary: `Clone subtask ${run}`,
		type: subtaskTypeId,
		parent: parentKey,
	});
	const subtaskKey = subtask.json().key as string;

	const cloned = await inject(
		"POST",
		`/api/issues/${subtaskKey}/clone`,
		userSession,
	);
	expect(cloned.statusCode).toBe(201);
	expect(cloned.json()).toMatchObject({
		summary: `CLONE - Clone subtask ${run}`,
		type: { id: subtaskTypeId },
		parent: { key: parentKey },
	});
});

test("clone hides an unreadable source and refuses a caller without Create issues", async () => {
	const hidden = await projectFixture(
		`H${run.slice(0, 6).toUpperCase()}`,
		`${tag} Hidden`,
	);
	hiddenProjectId = hidden.id;
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `${tag}:hidden-scheme`,
			name: `${tag} Hidden scheme`,
			projectIds: [hidden.id],
			raw: {},
		})
		.returning();
	hiddenSchemeId = scheme.id;
	const hiddenIssue = await createIssue(
		adminSession,
		{ summary: `Hidden source ${run}` },
		hidden.key,
	);
	expect(hiddenIssue.statusCode).toBe(201);

	const hiddenSource = await inject(
		"POST",
		`/api/issues/${hiddenIssue.json().key}/clone`,
		userSession,
		{},
	);
	expect(hiddenSource.statusCode).toBe(404);

	const source = await createIssue(userSession, {
		summary: `Create permission source ${run}`,
	});
	const denied = await inject(
		"POST",
		`/api/issues/${source.json().key}/clone`,
		viewerSession,
		{},
	);
	expect(denied.statusCode).toBe(403);
	expect(denied.json().error).toMatch(/CREATE_ISSUES/);
});

test("a link is checked against the outward issue, not the page it was created on", async () => {
	const linker = await makeUser(run, "linker");
	await grantDefaultProjectRole(
		concurrencyProjectId,
		[linker.username],
		"member",
	);

	const linkedIssue = await createIssue(
		userSession,
		{ summary: `Linked issue ${run}` },
		concurrencyKey,
	);
	const browsedIssue = await createIssue(userSession, {
		summary: `Browsed issue ${run}`,
	});
	expect(linkedIssue.statusCode).toBe(201);
	expect(browsedIssue.statusCode).toBe(201);
	const linkedKey = linkedIssue.json().key as string;
	const browsedKey = browsedIssue.json().key as string;

	const inwardFromBrowsedProject = await inject(
		"POST",
		`/api/issues/${linkedKey}/links`,
		linker.session,
		{ typeId: blocksTypeId, targetKey: browsedKey, direction: "inward" },
	);
	expect(inwardFromBrowsedProject.statusCode).toBe(403);
	expect(inwardFromBrowsedProject.json().error).toMatch(/LINK_ISSUES/);

	const inwardFromLinkedProject = await inject(
		"POST",
		`/api/issues/${browsedKey}/links`,
		linker.session,
		{ typeId: blocksTypeId, targetKey: linkedKey, direction: "inward" },
	);
	expect(inwardFromLinkedProject.statusCode).toBe(201);

	const outwardFromBrowsedProject = await inject(
		"POST",
		`/api/issues/${browsedKey}/links`,
		linker.session,
		{ typeId: blocksTypeId, targetKey: linkedKey, direction: "outward" },
	);
	expect(outwardFromBrowsedProject.statusCode).toBe(403);

	const outwardFromLinkedProject = await inject(
		"POST",
		`/api/issues/${linkedKey}/links`,
		linker.session,
		{ typeId: blocksTypeId, targetKey: browsedKey, direction: "outward" },
	);
	expect(outwardFromLinkedProject.statusCode).toBe(201);
});
