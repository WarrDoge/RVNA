import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { setMailTransport } from "../src/lib/server/mail.ts";
import { recordIssueEvent } from "../src/lib/server/notifications.ts";
import {
	emailBatches,
	issues,
	issueTypes,
	notifications,
	permissionGrants,
	permissionSchemes,
	projectIssueTypes,
	projectRoleActors,
	projects,
	projectWorkflows,
	statuses,
	userSettings,
	users,
	watchers,
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

const mailFailure = vi.hoisted(() => ({ remaining: 0 }));

vi.mock("../src/lib/server/mail.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../src/lib/server/mail.ts")>();
	return {
		...actual,
		queueEmailEvents: async (
			...args: Parameters<typeof actual.queueEmailEvents>
		) => {
			if (mailFailure.remaining > 0) {
				mailFailure.remaining -= 1;
				throw new Error("mail transport unavailable");
			}
			return actual.queueEmailEvents(...args);
		},
	};
});

const run = randomUUID().slice(0, 8);
const tag = `test-${run}`;
const projectKey = `N${run.slice(0, 6).toUpperCase()}`;

let app: TestApp;
let projectId: string;
let workflowId: string;
let taskTypeId: string;
let todoStatusId: string;
let inProgressStatusId: string;
let startTransitionId: string;

const sessions: Record<string, string> = {};
const ids: Record<string, string> = {};

function inject(
	method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
	url: string,
	session: string | null,
	payload?: unknown,
) {
	return app.inject({
		method,
		url,
		cookies: session ? { sid: session } : undefined,
		headers: session ? { "x-requested-with": "rvna" } : {},
		payload: payload as never,
	});
}

async function loginAs(name: string) {
	const result = await login(app, {
		sub: `${tag}-${name}`,
		username: `t-${run}-${name}`,
		name: `Test ${name}`,
		email: `t-${run}-${name}@example.test`,
		groups: [],
	});
	sessions[name] = result.sessionId as string;
}

async function createIssue(
	as: string,
	body: Record<string, unknown> = {},
): Promise<{ id: string; key: string; summary: string }> {
	const summary = `Notification issue ${randomUUID().slice(0, 8)}`;
	const response = await inject("POST", "/api/issues", sessions[as], {
		project: projectKey,
		type: taskTypeId,
		summary,
		...body,
	});
	expect(response.statusCode).toBe(201);
	const issue = response.json() as { id: string; key: string; summary: string };
	return { id: issue.id, key: issue.key, summary };
}

async function rowsFor(userId: string, issueKey: string) {
	return db
		.select()
		.from(notifications)
		.where(
			and(
				eq(notifications.userId, userId),
				eq(notifications.issueKey, issueKey),
			),
		)
		.orderBy(notifications.createdAt);
}

async function kindsFor(userId: string, issueKey: string) {
	return (await rowsFor(userId, issueKey)).map((row) => row.kind).sort();
}

async function watch(issueKey: string, userId: string) {
	const rows = await pool.query<{ id: string }>(
		"select id from issues where key = $1",
		[issueKey],
	);
	await db
		.insert(watchers)
		.values({ sourceId: null, issueId: rows.rows[0].id, userId })
		.onConflictDoNothing();
}

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

function mentionHtml(name: string, userId: string) {
	return `<p>See <a class="user-hover" data-user-id="${userId}">@${name}</a></p>`;
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();

	for (const name of [
		"actor",
		"reporter",
		"assignee",
		"watcher",
		"mentioned",
		"idle",
		"self",
	]) {
		await loginAs(name);
	}

	const rows = await pool.query<{ id: string; username: string }>(
		"select id, username from users where username like $1",
		[`t-${run}-%`],
	);
	for (const row of rows.rows) {
		ids[row.username.replace(`t-${run}-`, "")] = row.id;
	}

	const [type] = await db
		.insert(issueTypes)
		.values({ sourceId: `${tag}:type:task`, name: `${tag} Task` })
		.returning();
	taskTypeId = type.id;

	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}:status:todo`, name: `${tag} To Do`, category: "new" },
			{
				sourceId: `${tag}:status:progress`,
				name: `${tag} In Progress`,
				category: "indeterminate",
			},
		])
		.returning();
	todoStatusId = statusRows[0].id;
	inProgressStatusId = statusRows[1].id;

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

	const [transition] = await db
		.insert(workflowTransitions)
		.values({
			sourceId: `${tag}:transition:start`,
			workflowId,
			name: "Start progress",
			fromStatusId: todoStatusId,
			toStatusId: inProgressStatusId,
			sequence: 0,
		})
		.returning();
	startTransitionId = transition.id;

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project`,
			key: projectKey,
			name: `${tag} project`,
			projectType: "software",
			lastIssueNumber: 0,
		})
		.returning();
	projectId = project.id;
	await grantDefaultProjectRole(
		projectId,
		Object.values(ids).map((id) => {
			const row = rows.rows.find((candidate) => candidate.id === id);
			return row?.username ?? "";
		}),
	);

	await db.insert(projectIssueTypes).values({
		sourceId: `${tag}:project-type`,
		projectId,
		issueTypeId: taskTypeId,
	});
	await db.insert(projectWorkflows).values({
		sourceId: `${tag}:project-workflow`,
		projectId,
		issueTypeId: null,
		workflowId,
	});
});

afterAll(async () => {
	await pool.query("delete from projects where id = $1", [projectId]);
	await pool.query("delete from workflows where id = $1", [workflowId]);
	await pool.query("delete from issue_types where id = $1", [taskTypeId]);
	await pool.query("delete from statuses where id = any($1::uuid[])", [
		[todoStatusId, inProgressStatusId],
	]);
	await cleanupTestData(run);
	await app.close();
});

test("creating an issue notifies the assignee and autowatches the reporter", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });

	expect(await kindsFor(ids.assignee, issue.key)).toEqual(["created"]);
	expect(await kindsFor(ids.reporter, issue.key)).toEqual([]);

	const watching = await db
		.select()
		.from(watchers)
		.where(eq(watchers.issueId, issue.id));
	expect(watching.map((row) => row.userId)).toEqual([ids.reporter]);

	const assigneeRow = (await rowsFor(ids.assignee, issue.key))[0];
	expect(assigneeRow.direct).toBe(true);
	expect(assigneeRow.issueSummary).toBe(issue.summary);
	expect(assigneeRow.actorId).toBe(ids.reporter);

	expect(
		await db
			.select()
			.from(emailBatches)
			.where(eq(emailBatches.issueId, issue.id)),
	).toEqual([]);
});

test("a comment reaches reporter, assignee and watchers, never the actor", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });
	await watch(issue.key, ids.watcher);

	const response = await inject(
		"POST",
		`/api/issues/${issue.key}/comments`,
		sessions.actor,
		{ body: "<p>An ordinary comment</p>" },
	);
	expect(response.statusCode).toBe(201);

	expect(await kindsFor(ids.reporter, issue.key)).toEqual(["commented"]);
	expect(await kindsFor(ids.assignee, issue.key)).toEqual([
		"commented",
		"created",
	]);
	expect(await kindsFor(ids.watcher, issue.key)).toEqual(["commented"]);
	expect(await kindsFor(ids.actor, issue.key)).toEqual([]);
});

test("notify me of my own changes adds the actor back", async () => {
	await db.insert(userSettings).values({
		userId: ids.actor,
		notifyOwnChanges: true,
	});
	try {
		const issue = await createIssue("actor", { assignee: ids.assignee });
		const response = await inject(
			"POST",
			`/api/issues/${issue.key}/comments`,
			sessions.actor,
			{ body: "<p>My own comment</p>" },
		);
		expect(response.statusCode).toBe(201);
		expect(await kindsFor(ids.actor, issue.key)).toEqual([
			"commented",
			"created",
		]);
	} finally {
		await db.delete(userSettings).where(eq(userSettings.userId, ids.actor));
	}
});

test("inactive users receive nothing", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });
	await watch(issue.key, ids.idle);
	await db.update(users).set({ active: false }).where(eq(users.id, ids.idle));
	try {
		await inject("POST", `/api/issues/${issue.key}/comments`, sessions.actor, {
			body: "<p>Still here</p>",
		});
		expect(await rowsFor(ids.idle, issue.key)).toEqual([]);
		expect(await kindsFor(ids.reporter, issue.key)).toEqual(["commented"]);
	} finally {
		await db.update(users).set({ active: true }).where(eq(users.id, ids.idle));
	}
});

test("mention-only users are notified as mentioned", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });

	const response = await inject(
		"POST",
		`/api/issues/${issue.key}/comments`,
		sessions.actor,
		{ body: mentionHtml("mentioned", ids.mentioned) },
	);
	expect(response.statusCode).toBe(201);

	const rows = await rowsFor(ids.mentioned, issue.key);
	expect(rows).toHaveLength(1);
	expect(rows[0].kind).toBe("mentioned");
	expect(rows[0].direct).toBe(true);
	expect(await kindsFor(ids.reporter, issue.key)).toEqual(["commented"]);
});

test("autowatch off keeps the commenter out of the watchers", async () => {
	await db.insert(userSettings).values({ userId: ids.idle, autoWatch: false });
	try {
		const issue = await createIssue("reporter", { assignee: ids.assignee });
		await inject("POST", `/api/issues/${issue.key}/comments`, sessions.idle, {
			body: "<p>Passing through</p>",
		});
		const watching = await db
			.select()
			.from(watchers)
			.where(
				and(eq(watchers.issueId, issue.id), eq(watchers.userId, ids.idle)),
			);
		expect(watching).toEqual([]);
	} finally {
		await db.delete(userSettings).where(eq(userSettings.userId, ids.idle));
	}
});

test("assignment notifies and autowatches the new assignee", async () => {
	const issue = await createIssue("reporter");
	const response = await inject(
		"PATCH",
		`/api/issues/${issue.key}`,
		sessions.actor,
		{ assignee: ids.assignee },
	);
	expect(response.statusCode).toBe(200);

	expect(await kindsFor(ids.assignee, issue.key)).toEqual([
		"assigned",
		"updated",
	]);
	const watching = await db
		.select()
		.from(watchers)
		.where(
			and(eq(watchers.issueId, issue.id), eq(watchers.userId, ids.assignee)),
		);
	expect(watching).toHaveLength(1);
});

test("editing a comment mentions only the newly added users", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });
	const created = await inject(
		"POST",
		`/api/issues/${issue.key}/comments`,
		sessions.actor,
		{ body: mentionHtml("mentioned", ids.mentioned) },
	);
	const commentId = (created.json() as { id: string }).id;
	expect(await kindsFor(ids.mentioned, issue.key)).toEqual(["mentioned"]);

	const edited = await inject(
		"PATCH",
		`/api/issues/${issue.key}/comments/${commentId}`,
		sessions.actor,
		{
			body: `${mentionHtml("mentioned", ids.mentioned)}<p>and <a class="user-hover" data-user-id="${ids.watcher}">@watcher</a></p>`,
		},
	);
	expect(edited.statusCode).toBe(200);

	// The mention from the first comment is not repeated on the edit.
	expect(await kindsFor(ids.mentioned, issue.key)).toEqual(["mentioned"]);
	expect(await kindsFor(ids.watcher, issue.key)).toEqual(["mentioned"]);
	expect(await kindsFor(ids.reporter, issue.key)).toEqual([
		"comment_edited",
		"commented",
	]);
});

test("transitions, worklogs and attachments reach watchers", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });
	await watch(issue.key, ids.watcher);

	const transition = await inject(
		"POST",
		`/api/issues/${issue.key}/transitions`,
		sessions.actor,
		{ transitionId: startTransitionId },
	);
	expect(transition.statusCode).toBe(200);

	const worklog = await inject(
		"POST",
		`/api/issues/${issue.key}/worklogs`,
		sessions.actor,
		{ seconds: 1800, comment: "Half an hour" },
	);
	expect(worklog.statusCode).toBe(201);

	const prepared = multipartBody({
		name: "notes.txt",
		type: "text/plain",
		content: "attachment body",
	});
	const upload = await app.inject({
		method: "POST",
		url: `/api/issues/${issue.key}/attachments`,
		cookies: { sid: sessions.actor },
		headers: {
			"x-requested-with": "rvna",
			"content-type": prepared.contentType,
		},
		payload: prepared.body,
	});
	expect(upload.statusCode).toBe(201);

	const rows = await rowsFor(ids.watcher, issue.key);
	const kinds = rows.map((row) => row.kind);
	expect(kinds).toContain("transitioned");
	expect(kinds).toContain("worklog_added");
	expect(kinds).toContain("attachment_added");

	const transitionRow = rows.find((row) => row.kind === "transitioned");
	expect(transitionRow?.payload.changes[0]).toEqual({
		field: "Status",
		from: `${tag} To Do`,
		to: `${tag} In Progress`,
	});
	const worklogRow = rows.find((row) => row.kind === "worklog_added");
	expect(worklogRow?.payload.worklogSeconds).toBe(1800);
	expect(worklogRow?.payload.worklogComment).toBe("Half an hour");
});

test("deleting an issue notifies watchers and keeps the notification", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });
	await watch(issue.key, ids.watcher);
	const adminSession = await login(app, {
		sub: `${tag}-admin`,
		username: `t-${run}-admin`,
		name: "Test admin",
		email: `t-${run}-admin@example.test`,
		groups: [adminGroup()],
	});

	const response = await inject(
		"DELETE",
		`/api/issues/${issue.key}`,
		adminSession.sessionId as string,
	);
	expect(response.statusCode).toBe(204);

	const rows = await rowsFor(ids.watcher, issue.key);
	expect(rows.map((row) => row.kind)).toContain("deleted");
	expect(rows[0].issueKey).toBe(issue.key);

	const list = await inject("GET", "/api/notifications", sessions.watcher);
	const body = list.json() as {
		notifications: { id: string; issue: { key: string } }[];
	};
	const deleted = body.notifications.find((row) => row.issue.key === issue.key);
	expect(deleted).toBeDefined();
	const read = await inject(
		"POST",
		`/api/notifications/${deleted?.id}/read`,
		sessions.watcher,
	);
	expect(read.statusCode).toBe(200);
});

test("notification actors use the local avatar endpoint", async () => {
	await pool.query("update users set avatar_url = $1 where id = $2", [
		"https://jira.example/secure/useravatar?ownerId=imported",
		ids.actor,
	]);

	try {
		const issue = await createIssue("actor", { assignee: ids.reporter });
		const list = await inject("GET", "/api/notifications", sessions.reporter);
		expect(list.statusCode).toBe(200);
		const body = list.json() as {
			notifications: {
				issue: { key: string };
				actor: { id: string; avatarUrl: string | null } | null;
			}[];
		};
		const row = body.notifications.find((item) => item.issue.key === issue.key);
		expect(row?.actor).toMatchObject({
			id: ids.actor,
			avatarUrl: `/api/avatars/users/${ids.actor}`,
		});
	} finally {
		await pool.query("update users set avatar_url = null where id = $1", [
			ids.actor,
		]);
	}
});

test("notifications are private to their owner", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });
	await inject("POST", `/api/issues/${issue.key}/comments`, sessions.actor, {
		body: "<p>Private</p>",
	});

	const assigneeRows = await rowsFor(ids.assignee, issue.key);
	expect(assigneeRows.length).toBeGreaterThan(0);
	const foreignId = assigneeRows[0].id;

	const list = await inject("GET", "/api/notifications", sessions.reporter);
	expect(list.statusCode).toBe(200);
	const body = list.json() as {
		notifications: { id: string; issue: { key: string } }[];
		unread: number;
		total: number;
	};
	expect(body.notifications.every((row) => row.id !== foreignId)).toBe(true);
	expect(body.notifications.some((row) => row.issue.key === issue.key)).toBe(
		true,
	);

	const forbidden = await inject(
		"POST",
		`/api/notifications/${foreignId}/read`,
		sessions.reporter,
	);
	expect(forbidden.statusCode).toBe(404);

	const own = await inject(
		"POST",
		`/api/notifications/${body.notifications[0].id}/read`,
		sessions.reporter,
	);
	expect(own.statusCode).toBe(200);

	const unreadBefore = await inject(
		"GET",
		"/api/notifications/unread",
		sessions.assignee,
	);
	expect((unreadBefore.json() as { unread: number }).unread).toBeGreaterThan(0);

	const markAll = await inject(
		"POST",
		"/api/notifications/mark-all-read",
		sessions.reporter,
	);
	expect(markAll.statusCode).toBe(200);
	expect((markAll.json() as { unread: number }).unread).toBe(0);

	const assigneeUnread = await inject(
		"GET",
		"/api/notifications/unread",
		sessions.assignee,
	);
	expect((assigneeUnread.json() as { unread: number }).unread).toBe(
		(unreadBefore.json() as { unread: number }).unread,
	);
});

test("the list paginates and filters by tab", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });
	await watch(issue.key, ids.watcher);
	await inject("POST", `/api/issues/${issue.key}/comments`, sessions.actor, {
		body: mentionHtml("mentioned", ids.mentioned),
	});

	const first = await inject(
		"GET",
		"/api/notifications?limit=1&offset=0",
		sessions.mentioned,
	);
	expect(first.statusCode).toBe(200);
	const firstBody = first.json() as {
		notifications: unknown[];
		total: number;
		offset: number;
		limit: number;
	};
	expect(firstBody.notifications).toHaveLength(1);
	expect(firstBody.total).toBeGreaterThan(1);
	expect(firstBody.limit).toBe(1);

	const second = await inject(
		"GET",
		"/api/notifications?limit=1&offset=1",
		sessions.mentioned,
	);
	const secondBody = second.json() as { notifications: { id: string }[] };
	expect((secondBody.notifications[0] as { id: string }).id).not.toBe(
		(firstBody.notifications[0] as { id: string }).id,
	);

	const direct = await inject(
		"GET",
		"/api/notifications?tab=direct",
		sessions.mentioned,
	);
	const directBody = direct.json() as {
		notifications: { direct: boolean }[];
	};
	expect(directBody.notifications.every((row) => row.direct)).toBe(true);

	const watching = await inject(
		"GET",
		"/api/notifications?tab=watching",
		sessions.mentioned,
	);
	const watchingBody = watching.json() as {
		notifications: { direct: boolean }[];
	};
	expect(watchingBody.notifications.every((row) => !row.direct)).toBe(true);
});

test("notification settings default and persist", async () => {
	const defaults = await inject(
		"GET",
		"/api/me/notification-settings",
		sessions.idle,
	);
	expect(defaults.statusCode).toBe(200);
	expect(defaults.json()).toEqual({
		emailNotifications: true,
		notifyOwnChanges: false,
		autoWatch: true,
		emailFormat: "html",
	});

	const updated = await inject(
		"PUT",
		"/api/me/notification-settings",
		sessions.idle,
		{ emailNotifications: false, emailFormat: "text" },
	);
	expect(updated.statusCode).toBe(200);
	expect(updated.json()).toEqual({
		emailNotifications: false,
		notifyOwnChanges: false,
		autoWatch: true,
		emailFormat: "text",
	});

	const reread = await inject(
		"GET",
		"/api/me/notification-settings",
		sessions.idle,
	);
	expect(reread.json()).toEqual(updated.json());
});

test("watchers can be listed, added and removed", async () => {
	const issue = await createIssue("reporter");

	const added = await inject(
		"POST",
		`/api/issues/${issue.key}/watchers`,
		sessions.reporter,
		{ userId: ids.watcher },
	);
	expect(added.statusCode).toBe(200);
	expect(
		(added.json() as { watchers: { id: string }[] }).watchers.map(
			(row) => row.id,
		),
	).toContain(ids.watcher);

	const listed = await inject(
		"GET",
		`/api/issues/${issue.key}/watchers`,
		sessions.actor,
	);
	expect(listed.statusCode).toBe(200);
	expect(
		(listed.json() as { watchers: { id: string }[] }).watchers.map(
			(row) => row.id,
		),
	).toEqual(expect.arrayContaining([ids.reporter, ids.watcher]));

	const outsider = await login(app, {
		sub: `${tag}-watcher-outsider`,
		username: `t-${run}-watcher-outsider`,
		name: "Test watcher outsider",
		email: `t-${run}-watcher-outsider@example.test`,
		groups: [],
	});
	const forbidden = await inject(
		"DELETE",
		`/api/issues/${issue.key}/watchers/${ids.watcher}`,
		outsider.sessionId as string,
	);
	expect(forbidden.statusCode).toBe(403);

	const admin = await login(app, {
		sub: `${tag}-watcher-admin`,
		username: `t-${run}-watcher-admin`,
		name: "Test watcher admin",
		email: `t-${run}-watcher-admin@example.test`,
		groups: [adminGroup()],
	});
	const removed = await inject(
		"DELETE",
		`/api/issues/${issue.key}/watchers/${ids.watcher}`,
		admin.sessionId as string,
	);
	expect(removed.statusCode).toBe(200);
	expect(
		(removed.json() as { watchers: { id: string }[] }).watchers.map(
			(row) => row.id,
		),
	).not.toContain(ids.watcher);

	const unknown = await inject(
		"POST",
		`/api/issues/${issue.key}/watchers`,
		sessions.reporter,
		{ userId: randomUUID() },
	);
	expect(unknown.statusCode).toBe(400);
});

test("one recipient's email failure does not drop the rest of the batch", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });
	await watch(issue.key, ids.watcher);
	setMailTransport({ sendMail: async () => ({}) });
	mailFailure.remaining = 1;
	try {
		await recordIssueEvent({
			issue: {
				id: issue.id,
				key: issue.key,
				summary: issue.summary,
				reporterId: ids.reporter,
				assigneeId: ids.assignee,
			},
			actor: { id: ids.actor, displayName: "Test actor" },
			kind: "commented",
			commentHtml: "<p>A comment</p>",
		});

		const emails = await db
			.select({ userId: emailBatches.userId })
			.from(emailBatches)
			.where(eq(emailBatches.issueId, issue.id));
		expect(emails).toHaveLength(2);
		for (const email of emails) {
			expect([ids.reporter, ids.assignee, ids.watcher]).toContain(email.userId);
		}
	} finally {
		setMailTransport(null);
		mailFailure.remaining = 0;
		await db.delete(emailBatches).where(eq(emailBatches.issueId, issue.id));
	}
});

test("marking all read keeps notifications from projects the user cannot browse", async () => {
	const hiddenKey = `H${run.slice(0, 5).toUpperCase()}`;
	const [hiddenProject] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:hidden-project`,
			key: hiddenKey,
			name: `${tag} hidden project`,
			projectType: "software",
			lastIssueNumber: 0,
		})
		.returning();
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: `${tag}:hidden-scheme`,
			name: `${tag} hidden scheme`,
			projectIds: [hiddenProject.id],
			raw: {},
		})
		.returning();
	await db.insert(permissionGrants).values({
		sourceId: `${tag}:hidden-browse`,
		schemeId: scheme.id,
		permissionKey: "BROWSE_PROJECTS",
		holderType: "projectRole",
		holderParameter: "member",
		raw: {},
	});
	const [hiddenIssue] = await db
		.insert(issues)
		.values({
			sourceId: `${tag}:hidden-issue`,
			projectId: hiddenProject.id,
			number: 1,
			key: `${hiddenKey}-1`,
			typeId: taskTypeId,
			statusId: todoStatusId,
			summary: `Hidden issue ${run}`,
		})
		.returning();
	const [notification] = await db
		.insert(notifications)
		.values({
			userId: ids.idle,
			issueId: hiddenIssue.id,
			issueKey: hiddenIssue.key,
			issueSummary: hiddenIssue.summary,
			actorId: ids.actor,
			kind: "commented",
			direct: true,
			payload: {
				changes: [],
				commentHtml: null,
				attachmentName: null,
				worklogSeconds: null,
				worklogComment: null,
			},
		})
		.returning();

	try {
		const mark = await inject(
			"POST",
			"/api/notifications/mark-all-read",
			sessions.idle,
		);
		expect(mark.statusCode).toBe(200);
		const [row] = await db
			.select({ readAt: notifications.readAt })
			.from(notifications)
			.where(eq(notifications.id, notification.id));
		expect(row.readAt).toBeNull();
	} finally {
		await db.delete(notifications).where(eq(notifications.id, notification.id));
		await db.delete(projects).where(eq(projects.id, hiddenProject.id));
		await db
			.delete(permissionGrants)
			.where(eq(permissionGrants.schemeId, scheme.id));
		await db
			.delete(permissionSchemes)
			.where(eq(permissionSchemes.id, scheme.id));
	}
});

test("a recipient who lost project access gets neither a row nor an email", async () => {
	const issue = await createIssue("reporter", { assignee: ids.assignee });
	await watch(issue.key, ids.watcher);
	const schemeSource = `${tag}:lost-access:${randomUUID().slice(0, 8)}`;
	const [scheme] = await db
		.insert(permissionSchemes)
		.values({
			sourceId: schemeSource,
			name: `Lost access ${run}`,
			projectIds: [projectId],
			raw: {},
		})
		.returning({ id: permissionSchemes.id });
	await db.insert(permissionGrants).values({
		sourceId: `${schemeSource}:browse`,
		schemeId: scheme.id,
		permissionKey: "BROWSE_PROJECTS",
		holderType: "projectRole",
		holderParameter: "member",
		raw: {},
	});
	const watcherName = `t-${run}-watcher`;
	await db
		.delete(projectRoleActors)
		.where(
			and(
				eq(projectRoleActors.projectId, projectId),
				eq(projectRoleActors.actorParameter, watcherName),
			),
		);
	setMailTransport({ sendMail: async () => ({}) });
	try {
		await recordIssueEvent({
			issue: {
				id: issue.id,
				key: issue.key,
				summary: issue.summary,
				reporterId: ids.reporter,
				assigneeId: ids.assignee,
			},
			actor: { id: ids.actor, displayName: "Test actor" },
			kind: "commented",
			commentHtml: "<p>Only the project may see this</p>",
			mentionedUserIds: [ids.watcher],
		});

		expect(await rowsFor(ids.watcher, issue.key)).toEqual([]);
		expect(await rowsFor(ids.reporter, issue.key)).not.toEqual([]);
		const emails = await db
			.select({ userId: emailBatches.userId })
			.from(emailBatches)
			.where(eq(emailBatches.issueId, issue.id));
		expect(emails.map((row) => row.userId)).not.toContain(ids.watcher);
		expect(emails.map((row) => row.userId)).toContain(ids.reporter);
	} finally {
		setMailTransport(null);
		await grantDefaultProjectRole(projectId, [watcherName]);
		await db
			.delete(permissionGrants)
			.where(eq(permissionGrants.schemeId, scheme.id));
		await db
			.delete(permissionSchemes)
			.where(eq(permissionSchemes.id, scheme.id));
		await db.delete(emailBatches).where(eq(emailBatches.issueId, issue.id));
		await db.delete(notifications).where(eq(notifications.issueId, issue.id));
		await db.delete(watchers).where(eq(watchers.issueId, issue.id));
	}
});
