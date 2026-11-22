import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { env } from "../src/lib/server/env.ts";
import {
	components,
	issues,
	issueTypes,
	linkTypes,
	permissionGrants,
	permissionSchemes,
	projectIssueTypes,
	projects,
	projectWorkflows,
	statuses,
	versions,
	workflowStatuses,
	workflows,
	workflowTransitions,
} from "../src/lib/server/schema.ts";
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
const projectKey = `W${run.slice(0, 6).toUpperCase()}`;
const orderKey = `O${run.slice(0, 6).toUpperCase()}`;
const versionKey = `V${run.slice(0, 6).toUpperCase()}`;

let app: TestApp;
let userSession: string;
let otherSession: string;
let adminSession: string;
let otherId: string;
let projectId: string;
let orderProjectId: string;
let versionProjectId: string;
let taskTypeId: string;
let todoStatusId: string;
let inProgressStatusId: string;
let doneStatusId: string;
let startTransitionId: string;
let markDoneTransitionId: string;
let componentA: string;
let componentB: string;
let componentC: string;
let versionA: string;
let versionB: string;
let versionC: string;

const metadataIds: {
	issueTypes: string[];
	statuses: string[];
	linkTypes: string[];
} = { issueTypes: [], statuses: [], linkTypes: [] };

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

async function createIssue(
	session: string,
	body: Record<string, unknown> = {},
) {
	return inject("POST", "/api/issues", session, {
		project: projectKey,
		type: taskTypeId,
		summary: `Write test ${randomUUID().slice(0, 8)}`,
		...body,
	});
}

async function projectFixture(key: string, name: string, withWorkflow = true) {
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
	await db.insert(projectIssueTypes).values({
		sourceId: `${tag}:project-type:${key}`,
		projectId: project.id,
		issueTypeId: taskTypeId,
	});
	if (withWorkflow) {
		await db.insert(projectWorkflows).values({
			sourceId: `${tag}:project-workflow:${key}`,
			projectId: project.id,
			issueTypeId: null,
			workflowId: workflowIdForFixture,
		});
	}
	return project;
}

let workflowIdForFixture: string;

function multipartFiles(
	files: { name: string; type: string; content: string }[],
) {
	const boundary = `----rvna${randomUUID()}`;
	const chunks: Buffer[] = [];
	for (const file of files) {
		chunks.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
			),
			Buffer.from(file.content),
			Buffer.from("\r\n"),
		);
	}
	chunks.push(Buffer.from(`--${boundary}--\r\n`));
	return {
		body: Buffer.concat(chunks),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

async function allAttachmentFiles() {
	try {
		const entries = await readdir(env.ATTACHMENTS_DIR, {
			recursive: true,
			withFileTypes: true,
		});
		return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
	} catch {
		return [];
	}
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();

	const user = await login(app, {
		sub: `${tag}-user`,
		username: `t-${run}-user`,
		name: "Write User",
		email: `t-${run}-user@example.test`,
		groups: [],
	});
	userSession = user.sessionId as string;

	const other = await login(app, {
		sub: `${tag}-other`,
		username: `t-${run}-other`,
		name: "Write Other",
		email: `t-${run}-other@example.test`,
		groups: [],
	});
	otherSession = other.sessionId as string;

	const admin = await login(app, {
		sub: `${tag}-admin`,
		username: `t-${run}-admin`,
		name: "Write Admin",
		email: `t-${run}-admin@example.test`,
		groups: [adminGroup()],
	});
	adminSession = admin.sessionId as string;

	const userRows = await pool.query<{ id: string; username: string }>(
		"select id, username from users where username like $1",
		[`t-${run}-%`],
	);
	otherId = userRows.rows.find((row) => row.username === `t-${run}-other`)
		?.id as string;

	const [type] = await db
		.insert(issueTypes)
		.values({ sourceId: `${tag}:type:task`, name: `${tag} Task` })
		.returning();
	taskTypeId = type.id;
	metadataIds.issueTypes = [type.id];

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

	const [workflow] = await db
		.insert(workflows)
		.values({ sourceId: `${tag}:workflow`, name: `${tag} workflow` })
		.returning();
	workflowIdForFixture = workflow.id;

	await db.insert(workflowStatuses).values(
		statusRows.map((status) => ({
			sourceId: `${tag}:workflow-status:${status.id}`,
			workflowId: workflow.id,
			statusId: status.id,
		})),
	);

	const transitions = await db
		.insert(workflowTransitions)
		.values([
			{
				sourceId: `${tag}:transition:start`,
				workflowId: workflow.id,
				name: "Start progress",
				fromStatusId: todoStatusId,
				toStatusId: inProgressStatusId,
				sequence: 0,
			},
			{
				sourceId: `${tag}:transition:mark-done`,
				workflowId: workflow.id,
				name: "Mark done",
				fromStatusId: todoStatusId,
				toStatusId: doneStatusId,
				sequence: 1,
			},
		])
		.returning();
	startTransitionId = transitions[0].id;
	markDoneTransitionId = transitions[1].id;

	const project = await projectFixture(projectKey, `${tag} Project`);
	projectId = project.id;
	await grantDefaultProjectRole(
		projectId,
		[`t-${run}-user`, `t-${run}-other`],
		"member",
	);
	const orderProject = await projectFixture(orderKey, `${tag} Order`, false);
	orderProjectId = orderProject.id;
	const versionProject = await projectFixture(
		versionKey,
		`${tag} Versions`,
		false,
	);
	versionProjectId = versionProject.id;

	const componentRows = await db
		.insert(components)
		.values([
			{ sourceId: `${tag}:component:a`, projectId, name: `${tag} A` },
			{ sourceId: `${tag}:component:b`, projectId, name: `${tag} B` },
			{ sourceId: `${tag}:component:c`, projectId, name: `${tag} C` },
		])
		.returning();
	componentA = componentRows[0].id;
	componentB = componentRows[1].id;
	componentC = componentRows[2].id;

	const versionRows = await db
		.insert(versions)
		.values([
			{ sourceId: `${tag}:version:a`, projectId, name: `${tag} 1.0` },
			{ sourceId: `${tag}:version:b`, projectId, name: `${tag} 2.0` },
			{ sourceId: `${tag}:version:c`, projectId, name: `${tag} 3.0` },
		])
		.returning();
	versionA = versionRows[0].id;
	versionB = versionRows[1].id;
	versionC = versionRows[2].id;

	const [linkType] = await db
		.insert(linkTypes)
		.values({
			sourceId: `${tag}:link-type`,
			name: `${tag} Blocks`,
			inward: `${tag} is blocked by`,
			outward: `${tag} blocks`,
		})
		.returning();
	metadataIds.linkTypes = [linkType.id];
});

afterAll(async () => {
	await pool.query("delete from projects where id = any($1::uuid[])", [
		[projectId, orderProjectId, versionProjectId],
	]);
	await pool.query("delete from workflows where id = $1", [
		workflowIdForFixture,
	]);
	await pool.query("delete from issue_types where id = any($1::uuid[])", [
		metadataIds.issueTypes,
	]);
	await pool.query("delete from statuses where id = any($1::uuid[])", [
		metadataIds.statuses,
	]);
	await pool.query("delete from link_types where id = any($1::uuid[])", [
		metadataIds.linkTypes,
	]);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("concurrent transitions from one status: one wins, the other is rejected", async () => {
	const created = await createIssue(userSession);
	expect(created.statusCode).toBe(201);
	const key = created.json().key as string;

	const [first, second] = await Promise.all([
		inject("POST", `/api/issues/${key}/transitions`, userSession, {
			transitionId: startTransitionId,
		}),
		inject("POST", `/api/issues/${key}/transitions`, userSession, {
			transitionId: markDoneTransitionId,
		}),
	]);

	const codes = [first.statusCode, second.statusCode].sort();
	expect(codes).toEqual([200, 409]);

	const winner = first.statusCode === 200 ? first : second;
	const final = await inject("GET", `/api/issues/${key}`, userSession);
	expect(final.statusCode).toBe(200);
	expect(final.json().status.id).toBe(winner.json().status.id);

	const history = await inject(
		"GET",
		`/api/issues/${key}/history`,
		userSession,
	);
	const statusItems = history
		.json()
		.flatMap((entry: { items: { field: string }[] }) => entry.items)
		.filter((item: { field: string }) => item.field === "status");
	expect(statusItems).toHaveLength(1);
	expect(statusItems[0].fromText).toBe(`${tag} To Do`);
});

test("concurrent worklog adds both count", async () => {
	const created = await createIssue(userSession);
	const key = created.json().key as string;
	const prepared = await inject("PATCH", `/api/issues/${key}`, userSession, {
		remainingEstimate: 7200,
	});
	expect(prepared.statusCode).toBe(200);

	const responses = await Promise.all(
		Array.from({ length: 3 }, () =>
			inject("POST", `/api/issues/${key}/worklogs`, userSession, {
				seconds: 1800,
			}),
		),
	);
	for (const response of responses) {
		expect(response.statusCode).toBe(201);
	}

	const detail = await inject("GET", `/api/issues/${key}`, userSession);
	expect(detail.json().timeTracking).toMatchObject({
		timeSpent: 5400,
		remainingEstimate: 1800,
	});
	const listed = await inject(
		"GET",
		`/api/issues/${key}/worklogs`,
		userSession,
	);
	expect(listed.json()).toHaveLength(3);
});

test("concurrent worklog deletes adjust once per removed worklog", async () => {
	const created = await createIssue(userSession);
	const key = created.json().key as string;
	await inject("PATCH", `/api/issues/${key}`, userSession, {
		remainingEstimate: 7200,
	});
	const first = await inject(
		"POST",
		`/api/issues/${key}/worklogs`,
		userSession,
		{
			seconds: 3600,
		},
	);
	const second = await inject(
		"POST",
		`/api/issues/${key}/worklogs`,
		userSession,
		{ seconds: 3600 },
	);
	expect(first.statusCode).toBe(201);
	expect(second.statusCode).toBe(201);

	const [left, right] = await Promise.all([
		inject(
			"DELETE",
			`/api/issues/${key}/worklogs/${first.json().id}`,
			userSession,
		),
		inject(
			"DELETE",
			`/api/issues/${key}/worklogs/${second.json().id}`,
			userSession,
		),
	]);
	expect(left.statusCode).toBe(204);
	expect(right.statusCode).toBe(204);

	const detail = await inject("GET", `/api/issues/${key}`, userSession);
	expect(detail.json().timeTracking).toMatchObject({
		timeSpent: 0,
		remainingEstimate: 7200,
	});
});

test("a notification failure never fails issue, comment, worklog or attachment writes", async () => {
	const suffix = tag.replace(/-/g, "_");
	await pool.query(`
		create or replace function ${suffix}_fail_notification()
		returns trigger as $$
		begin
			if new.issue_key like '${projectKey}-%' then
				raise exception 'notification write failed';
			end if;
			return new;
		end;
		$$ language plpgsql
	`);
	await pool.query(
		`create trigger ${suffix}_fail_notification before insert on notifications for each row execute function ${suffix}_fail_notification()`,
	);
	try {
		const created = await createIssue(userSession);
		expect(created.statusCode).toBe(201);
		const key = created.json().key as string;

		const comment = await inject(
			"POST",
			`/api/issues/${key}/comments`,
			otherSession,
			{ body: "<p>Comment with a broken notification</p>" },
		);
		expect(comment.statusCode).toBe(201);

		const worklog = await inject(
			"POST",
			`/api/issues/${key}/worklogs`,
			userSession,
			{ seconds: 60 },
		);
		expect(worklog.statusCode).toBe(201);

		const upload = multipartFiles([
			{ name: "broken-notification.txt", type: "text/plain", content: "body" },
		]);
		const attachment = await inject(
			"POST",
			`/api/issues/${key}/attachments`,
			userSession,
			upload.body,
			{ "content-type": upload.contentType },
		);
		expect(attachment.statusCode).toBe(201);

		const comments = await inject(
			"GET",
			`/api/issues/${key}/comments`,
			userSession,
		);
		expect(comments.json()).toHaveLength(1);
		const detail = await inject("GET", `/api/issues/${key}`, userSession);
		expect(detail.json().attachments).toHaveLength(1);
		expect(detail.json().timeTracking.timeSpent).toBe(60);
	} finally {
		await pool.query(
			`drop trigger if exists ${suffix}_fail_notification on notifications`,
		);
		await pool.query(`drop function if exists ${suffix}_fail_notification()`);
	}
});

test("concurrent PATCHes keep every label, component and fix version addition", async () => {
	const created = await createIssue(userSession, {
		labels: ["base"],
		components: [componentA],
		fixVersions: [versionA],
	});
	expect(created.statusCode).toBe(201);
	const key = created.json().key as string;

	const [first, second] = await Promise.all([
		inject("PATCH", `/api/issues/${key}`, userSession, {
			labels: ["base", "alpha"],
			components: [componentA, componentB],
			fixVersions: [versionA, versionB],
		}),
		inject("PATCH", `/api/issues/${key}`, userSession, {
			labels: ["base", "beta"],
			components: [componentA, componentC],
			fixVersions: [versionA, versionC],
		}),
	]);
	expect(first.statusCode).toBe(200);
	expect(second.statusCode).toBe(200);

	const detail = await inject("GET", `/api/issues/${key}`, userSession);
	const body = detail.json();
	expect(body.labels).toEqual(["alpha", "base", "beta"]);
	expect(body.components.map((item: { id: string }) => item.id).sort()).toEqual(
		[componentA, componentB, componentC].sort(),
	);
	expect(
		body.fixVersions.map((item: { id: string }) => item.id).sort(),
	).toEqual([versionA, versionB, versionC].sort());

	const history = await inject(
		"GET",
		`/api/issues/${key}/history`,
		userSession,
	);
	const items = history
		.json()
		.flatMap((entry: { items: unknown[] }) => entry.items) as {
		field: string;
		fromText: string | null;
		toText: string | null;
	}[];
	const labelItems = items.filter((item) => item.field === "labels");
	expect(labelItems).toHaveLength(2);
	expect(labelItems.some((item) => item.fromText === "base")).toBe(true);
	const finalLabels = labelItems.find(
		(item) => item.toText === "alpha base beta",
	);
	expect(finalLabels).toBeDefined();
	expect(finalLabels?.fromText).not.toBe("base");
});

test("a failed second attachment leaves no attachment behind", async () => {
	const created = await createIssue(userSession);
	const key = created.json().key as string;
	const beforeFiles = await allAttachmentFiles();
	const suffix = tag.replace(/-/g, "_");
	await pool.query(`
		create or replace function ${suffix}_fail_attachment()
		returns trigger as $$
		begin
			if new.file_name = 'fail.txt' then
				raise exception 'attachment write failed';
			end if;
			return new;
		end;
		$$ language plpgsql
	`);
	await pool.query(
		`create trigger ${suffix}_fail_attachment before insert on attachments for each row execute function ${suffix}_fail_attachment()`,
	);
	try {
		const upload = multipartFiles([
			{ name: "good.txt", type: "text/plain", content: "good" },
			{ name: "fail.txt", type: "text/plain", content: "fail" },
		]);
		const response = await inject(
			"POST",
			`/api/issues/${key}/attachments`,
			userSession,
			upload.body,
			{ "content-type": upload.contentType },
		);
		expect(response.statusCode).toBe(500);

		const detail = await inject("GET", `/api/issues/${key}`, userSession);
		expect(detail.json().attachments).toEqual([]);
		expect(await allAttachmentFiles()).toEqual(beforeFiles);
	} finally {
		await pool.query(
			`drop trigger if exists ${suffix}_fail_attachment on attachments`,
		);
		await pool.query(`drop function if exists ${suffix}_fail_attachment()`);
	}
});

test("concurrent version creates allocate unique sequences", async () => {
	const responses = await Promise.all(
		Array.from({ length: 8 }, (_, index) =>
			inject("POST", `/api/projects/${versionKey}/versions`, adminSession, {
				name: `Concurrent ${index}`,
			}),
		),
	);
	for (const response of responses) {
		expect(response.statusCode).toBe(201);
	}
	const sequences = responses
		.map((response) => response.json().id as string)
		.map((id) => id);
	const rows = await pool.query<{ sequence: number }>(
		"select sequence from versions where project_id = $1 order by sequence",
		[versionProjectId],
	);
	expect(rows.rows.map((row) => row.sequence)).toEqual([
		1, 2, 3, 4, 5, 6, 7, 8,
	]);
	expect(new Set(sequences).size).toBe(8);
});

test("the project issue list uses the issue number as its tie-breaker", async () => {
	const created = new Date("2026-02-01T10:00:00.000Z");
	await db.insert(issues).values([
		{
			id: "00000000-0000-4000-8000-000000000002",
			sourceId: `${tag}:order:100`,
			projectId: orderProjectId,
			number: 100,
			key: `${orderKey}-100`,
			typeId: taskTypeId,
			statusId: todoStatusId,
			summary: "Order 100",
			created,
			updated: created,
		},
		{
			id: "00000000-0000-4000-8000-000000000001",
			sourceId: `${tag}:order:101`,
			projectId: orderProjectId,
			number: 101,
			key: `${orderKey}-101`,
			typeId: taskTypeId,
			statusId: todoStatusId,
			summary: "Order 101",
			created,
			updated: created,
		},
	]);

	const first = await inject(
		"GET",
		`/api/projects/${orderKey}/issues?offset=0&limit=1`,
		userSession,
	);
	const second = await inject(
		"GET",
		`/api/projects/${orderKey}/issues?offset=1&limit=1`,
		userSession,
	);
	expect(first.statusCode).toBe(200);
	expect(second.statusCode).toBe(200);
	expect(first.json().issues[0].key).toBe(`${orderKey}-101`);
	expect(second.json().issues[0].key).toBe(`${orderKey}-100`);
});

test("comments and attachments move the issue updated timestamp", async () => {
	const created = await createIssue(userSession);
	const key = created.json().key as string;
	const old = new Date("2020-01-01T00:00:00.000Z");
	const setOld = () =>
		pool.query("update issues set updated = $1 where key = $2", [old, key]);

	await setOld();
	const comment = await inject(
		"POST",
		`/api/issues/${key}/comments`,
		userSession,
		{ body: "<p>Activity</p>" },
	);
	expect(comment.statusCode).toBe(201);
	const afterComment = await inject("GET", `/api/issues/${key}`, userSession);
	expect(new Date(afterComment.json().updated).getTime()).toBeGreaterThan(
		old.getTime(),
	);

	const commentId = comment.json().id as string;
	await setOld();
	const edited = await inject(
		"PATCH",
		`/api/issues/${key}/comments/${commentId}`,
		userSession,
		{ body: "<p>Edited activity</p>" },
	);
	expect(edited.statusCode).toBe(200);
	const afterEdit = await inject("GET", `/api/issues/${key}`, userSession);
	expect(new Date(afterEdit.json().updated).getTime()).toBeGreaterThan(
		old.getTime(),
	);

	await setOld();
	const deleted = await inject(
		"DELETE",
		`/api/issues/${key}/comments/${commentId}`,
		userSession,
	);
	expect(deleted.statusCode).toBe(204);
	const afterDelete = await inject("GET", `/api/issues/${key}`, userSession);
	expect(new Date(afterDelete.json().updated).getTime()).toBeGreaterThan(
		old.getTime(),
	);

	const upload = multipartFiles([
		{ name: "activity.txt", type: "text/plain", content: "activity" },
	]);
	await setOld();
	const attached = await inject(
		"POST",
		`/api/issues/${key}/attachments`,
		userSession,
		upload.body,
		{ "content-type": upload.contentType },
	);
	expect(attached.statusCode).toBe(201);
	const afterAttach = await inject("GET", `/api/issues/${key}`, userSession);
	expect(new Date(afterAttach.json().updated).getTime()).toBeGreaterThan(
		old.getTime(),
	);

	await setOld();
	const removed = await inject(
		"DELETE",
		`/api/attachments/${attached.json()[0].id}`,
		userSession,
	);
	expect(removed.statusCode).toBe(204);
	const afterRemove = await inject("GET", `/api/issues/${key}`, userSession);
	expect(new Date(afterRemove.json().updated).getTime()).toBeGreaterThan(
		old.getTime(),
	);
});

test("editing a comment deleted meanwhile answers 404 and records no event", async () => {
	const created = await createIssue(userSession);
	const key = created.json().key as string;
	const comment = await inject(
		"POST",
		`/api/issues/${key}/comments`,
		otherSession,
		{ body: "<p>Racing comment</p>" },
	);
	expect(comment.statusCode).toBe(201);
	const commentId = comment.json().id as string;

	const blocker = await pool.connect();
	let response: Awaited<ReturnType<typeof inject>> | undefined;
	try {
		await blocker.query("begin");
		await blocker.query("select id from comments where id = $1 for update", [
			commentId,
		]);
		const pending = inject(
			"PATCH",
			`/api/issues/${key}/comments/${commentId}`,
			otherSession,
			{ body: "<p>Edited too late</p>" },
		);
		// Wait until the PATCH is blocked on the row this transaction holds, so
		// the edit has already loaded the comment and the delete wins the race.
		for (let attempt = 0; attempt < 100; attempt++) {
			const waiting = await pool.query<{ count: number }>(
				`select count(*)::int as count from pg_stat_activity
				 where wait_event_type = 'Lock'
				   and query ilike '%update%comments%'`,
			);
			if ((waiting.rows[0]?.count ?? 0) > 0) break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		await blocker.query("delete from comments where id = $1", [commentId]);
		await blocker.query("commit");
		response = await pending;
	} finally {
		blocker.release();
	}

	expect(response?.statusCode).toBe(404);
	expect(response?.json()).toEqual({ error: "Comment not found" });
	const events = await pool.query<{ count: number }>(
		`select count(*)::int as count from notifications
		 where issue_key = $1 and kind = 'comment_edited'`,
		[key],
	);
	expect(events.rows[0]?.count).toBe(0);
});

test("only the watcher or an admin may remove a watcher", async () => {
	const created = await createIssue(userSession);
	const key = created.json().key as string;
	const added = await inject(
		"POST",
		`/api/issues/${key}/watchers`,
		userSession,
		{ userId: otherId },
	);
	expect(added.statusCode).toBe(200);

	const outsider = await login(app, {
		sub: `${tag}-outsider`,
		username: `t-${run}-outsider`,
		name: "Outsider",
		groups: [],
	});
	const forbidden = await inject(
		"DELETE",
		`/api/issues/${key}/watchers/${otherId}`,
		outsider.sessionId as string,
	);
	expect(forbidden.statusCode).toBe(403);

	const removedByAdmin = await inject(
		"DELETE",
		`/api/issues/${key}/watchers/${otherId}`,
		adminSession,
	);
	expect(removedByAdmin.statusCode).toBe(200);
});

test("component leads must be active users", async () => {
	const missing = randomUUID();
	const created = await inject(
		"POST",
		`/api/projects/${projectKey}/components`,
		adminSession,
		{ name: "Broken lead", leadId: missing },
	);
	expect(created.statusCode).toBe(400);

	const [component] = await db
		.insert(components)
		.values({
			sourceId: `${tag}:component:lead`,
			projectId,
			name: `${tag} Lead`,
		})
		.returning();
	const patched = await inject(
		"PATCH",
		`/api/components/${component.id}`,
		adminSession,
		{ leadId: missing },
	);
	expect(patched.statusCode).toBe(400);
});

test("MODIFY_REPORTER and SCHEDULE_ISSUES gate their fields", async () => {
	const key = `M${run.slice(0, 6).toUpperCase()}`;
	const project = await projectFixture(key, `${tag} Reporter`);
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `${tag}:reporter-scheme`,
			name: `${tag} reporter scheme`,
			projectIds: [project.id],
			raw: {},
		})
		.returning();
	await db.insert(permissionGrants).values([
		{
			sourceId: `${tag}:reporter-browse`,
			schemeId: scheme.id,
			permissionKey: "BROWSE_PROJECTS",
			holderType: "anyone",
			holderParameter: null,
			raw: {},
		},
		{
			sourceId: `${tag}:reporter-create`,
			schemeId: scheme.id,
			permissionKey: "CREATE_ISSUES",
			holderType: "projectRole",
			holderParameter: "member",
			raw: {},
		},
		{
			sourceId: `${tag}:reporter-edit`,
			schemeId: scheme.id,
			permissionKey: "EDIT_ISSUES",
			holderType: "projectRole",
			holderParameter: "member",
			raw: {},
		},
		{
			sourceId: `${tag}:reporter-schedule`,
			schemeId: scheme.id,
			permissionKey: "SCHEDULE_ISSUES",
			holderType: "projectRole",
			holderParameter: "member",
			raw: {},
		},
	]);
	await grantDefaultProjectRole(project.id, [`t-${run}-user`], "member");
	const { rows } = await pool.query<{ id: string }>(
		"select id from users where username = $1",
		[`t-${run}-user`],
	);
	const userId = rows[0].id;

	try {
		const deniedCreate = await inject("POST", "/api/issues", userSession, {
			project: key,
			type: taskTypeId,
			summary: "Denied reporter create",
			reporter: otherId,
		});
		expect(deniedCreate.statusCode).toBe(403);
		expect(deniedCreate.json().error).toContain("MODIFY_REPORTER");

		const ownCreate = await inject("POST", "/api/issues", userSession, {
			project: key,
			type: taskTypeId,
			summary: "Own reporter create",
			reporter: userId,
		});
		expect(ownCreate.statusCode).toBe(201);
		const issueKey = ownCreate.json().key as string;

		const deniedPatch = await inject(
			"PATCH",
			`/api/issues/${issueKey}`,
			userSession,
			{ reporter: otherId },
		);
		expect(deniedPatch.statusCode).toBe(403);
		expect(deniedPatch.json().error).toContain("MODIFY_REPORTER");

		const scheduled = await inject(
			"PATCH",
			`/api/issues/${issueKey}`,
			userSession,
			{ dueDate: "2026-12-01" },
		);
		expect(scheduled.statusCode).toBe(200);

		await db.insert(permissionGrants).values({
			sourceId: `${tag}:reporter-modify`,
			schemeId: scheme.id,
			permissionKey: "MODIFY_REPORTER",
			holderType: "projectRole",
			holderParameter: "member",
			raw: {},
		});
		const allowed = await inject(
			"PATCH",
			`/api/issues/${issueKey}`,
			userSession,
			{ reporter: otherId },
		);
		expect(allowed.statusCode).toBe(200);
		expect(allowed.json().reporter.id).toBe(otherId);

		await pool.query("delete from permission_grants where source_id = $1", [
			`${tag}:reporter-schedule`,
		]);
		const unscheduled = await inject(
			"PATCH",
			`/api/issues/${issueKey}`,
			userSession,
			{ dueDate: "2026-12-02" },
		);
		expect(unscheduled.statusCode).toBe(403);
		expect(unscheduled.json().error).toContain("SCHEDULE_ISSUES");
	} finally {
		await pool.query("delete from issues where project_id = $1", [project.id]);
		await pool.query("delete from permission_schemes where id = $1", [
			scheme.id,
		]);
		await pool.query("delete from projects where id = $1", [project.id]);
	}
});

test("an edit that sends the unchanged reporter and due date is not refused", async () => {
	const key = `U${run.slice(0, 6).toUpperCase()}`;
	const project = await projectFixture(key, `${tag} Unchanged`);
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `${tag}:unchanged-scheme`,
			name: `${tag} unchanged scheme`,
			projectIds: [project.id],
			raw: {},
		})
		.returning();
	await db.insert(permissionGrants).values(
		(
			[
				["BROWSE_PROJECTS", "anyone", null],
				["CREATE_ISSUES", "projectRole", "member"],
				["EDIT_ISSUES", "projectRole", "member"],
			] as const
		).map(([permissionKey, holderType, holderParameter]) => ({
			sourceId: `${tag}:unchanged-${permissionKey}`,
			schemeId: scheme.id,
			permissionKey,
			holderType,
			holderParameter,
			raw: {},
		})),
	);
	await grantDefaultProjectRole(project.id, [`t-${run}-user`], "member");
	const { rows } = await pool.query<{ id: string }>(
		"select id from users where username = $1",
		[`t-${run}-user`],
	);
	const userId = rows[0].id;

	try {
		const created = await inject("POST", "/api/issues", userSession, {
			project: key,
			type: taskTypeId,
			summary: "Unchanged fields",
		});
		expect(created.statusCode).toBe(201);
		const issueKey = created.json().key as string;
		await pool.query(
			"update issues set due_date = '2026-12-01' where key = $1",
			[issueKey],
		);

		// The edit dialog sends every field; only the summary differs.
		const withReporter = await inject(
			"PATCH",
			`/api/issues/${issueKey}`,
			userSession,
			{
				summary: "Unchanged fields, new summary",
				reporter: userId,
				dueDate: "2026-12-01",
			},
		);
		expect(withReporter.statusCode).toBe(200);
		expect(withReporter.json().dueDate).toBe("2026-12-01");

		// An imported issue can have no reporter and no due date at all.
		await pool.query(
			"update issues set reporter_id = null, due_date = null where key = $1",
			[issueKey],
		);
		const withoutReporter = await inject(
			"PATCH",
			`/api/issues/${issueKey}`,
			userSession,
			{ summary: "Still no reporter", reporter: null, dueDate: null },
		);
		expect(withoutReporter.statusCode).toBe(200);
	} finally {
		await pool.query("delete from issues where project_id = $1", [project.id]);
		await pool.query("delete from permission_schemes where id = $1", [
			scheme.id,
		]);
		await pool.query("delete from projects where id = $1", [project.id]);
	}
});

test("one request loads the global permission data once", async () => {
	const created = await createIssue(userSession);
	expect(created.statusCode).toBe(201);
	const key = created.json().key as string;

	const original = pool.query.bind(pool);
	const statements: string[] = [];
	(pool as unknown as { query: typeof pool.query }).query = ((
		query: { text?: string } | string,
		...rest: unknown[]
	) => {
		statements.push(typeof query === "string" ? query : (query.text ?? ""));
		return (original as (...args: unknown[]) => unknown)(query, ...rest);
	}) as typeof pool.query;
	try {
		const response = await inject("PATCH", `/api/issues/${key}`, userSession, {
			assignee: otherId,
		});
		expect(response.statusCode).toBe(200);
	} finally {
		(pool as unknown as { query: typeof pool.query }).query = original;
	}

	const loads = statements.filter((statement) =>
		statement.includes('from "permission_schemes"'),
	);
	expect(loads).toHaveLength(1);
});
