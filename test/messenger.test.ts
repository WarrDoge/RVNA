import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { stopMessengerQueue } from "../src/lib/server/messenger/notices.ts";
import {
	createMessengerWorker,
	isMessengerWorkerRunning,
	startMessengerWorker,
	stopMessengerWorker,
} from "../src/lib/server/messenger/worker.ts";
import { recordIssueEvent } from "../src/lib/server/notifications.ts";
import {
	auditLog,
	comments,
	issues,
	issueTypes,
	messengerConfig,
	messengerLinkCodes,
	messengerProcessedEvents,
	messengerRooms,
	messengerThreads,
	messengerUnknownSenders,
	projectIssueTypes,
	projects,
	projectWorkflows,
	requestTypeFields,
	requestTypes,
	serviceDesks,
	slaCalendars,
	slaCycles,
	slaGoals,
	slaMetrics,
	statuses,
	users,
	workflowStatuses,
	workflows,
} from "../src/lib/server/schema.ts";
import { FakeMatrix } from "./helpers/fake-matrix.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const tag = `mx-${run}`;
const projectKey = `MX${run.slice(0, 5).toUpperCase()}`;
const roomId = `!room-${run}:matrix.test`;
const encryptedRoomId = `!encrypted-${run}:matrix.test`;

let app: TestApp;
let fake: FakeMatrix;
let adminSession: string;
let aliceSession: string;
let bobSession: string;
let aliceId: string;
let bobId: string;
let projectId: string;
let deskId: string;
let requestTypeId: string;
let issueTypeId: string;
let statusIds: string[];
let workflowId: string;
let metricId: string;
let ticketKey = "";
let ticketIssueId = "";
let ticketRoot = "";

const week = [
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
];

function inject(
	method: "GET" | "PUT" | "POST" | "DELETE",
	url: string,
	session: string | null,
	payload?: unknown,
) {
	return app.inject({
		method,
		url,
		cookies: session ? { sid: session } : undefined,
		headers: {
			...(session ? { "x-requested-with": "rvna" } : {}),
			...(payload === undefined ? {} : { "content-type": "application/json" }),
		},
		payload: payload as never,
	});
}

async function waitForSend(
	predicate: (body: string) => boolean,
	timeout = 10_000,
) {
	return fake.waitFor(() => {
		const found = fake.sent.find(
			(item) =>
				item.eventType === "m.room.message" &&
				typeof item.content.body === "string" &&
				predicate(item.content.body),
		);
		return found ? (found.content.body as string) : null;
	}, timeout);
}

async function deskIssueCount() {
	const rows = await db
		.select({ id: issues.id })
		.from(issues)
		.where(eq(issues.projectId, projectId));
	return rows.length;
}

async function command(
	sender: string,
	body: string,
	eventId = `$cmd-${randomUUID()}`,
	room = roomId,
) {
	const before = fake.sent.length;
	fake.pushTimeline(room, [
		{
			type: "m.room.message",
			event_id: eventId,
			sender,
			content: { msgtype: "m.text", body },
		},
	]);
	await fake.waitFor(() => fake.sent.length > before, 15_000);
	return fake.sent.slice(before);
}

beforeAll(async () => {
	await runMigrations();
	await db.delete(messengerThreads);
	await db.delete(messengerProcessedEvents);
	await db.delete(messengerRooms);
	await db.delete(messengerUnknownSenders);
	await db.delete(messengerLinkCodes);
	await db.delete(messengerConfig);

	app = buildServer();
	await app.ready();

	fake = await new FakeMatrix({ port: 5176 }).start();

	const admin = await login(app, {
		sub: `${tag}-admin`,
		username: `t-${run}-admin`,
		name: "Messenger Admin",
		groups: [adminGroup()],
	});
	adminSession = admin.sessionId as string;
	const alice = await login(app, {
		sub: `${tag}-alice`,
		username: `t-${run}-alice`,
		name: "Alice Sender",
		groups: [],
	});
	aliceSession = alice.sessionId as string;
	const bob = await login(app, {
		sub: `${tag}-bob`,
		username: `t-${run}-bob`,
		name: "Bob Sender",
		groups: [],
	});
	bobSession = bob.sessionId as string;
	const aliceRow = await pool.query<{ id: string }>(
		"select id from users where username = $1",
		[`t-${run}-alice`],
	);
	const bobRow = await pool.query<{ id: string }>(
		"select id from users where username = $1",
		[`t-${run}-bob`],
	);
	aliceId = aliceRow.rows[0].id;
	bobId = bobRow.rows[0].id;

	const type = await db
		.insert(issueTypes)
		.values({ sourceId: `${tag}:type`, name: `${tag} Request` })
		.returning();
	issueTypeId = type[0].id;
	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}:status:open`, name: "Open", category: "new" },
			{
				sourceId: `${tag}:status:progress`,
				name: "In Progress",
				category: "indeterminate",
			},
		])
		.returning();
	statusIds = statusRows.map((row) => row.id);
	const [workflow] = await db
		.insert(workflows)
		.values({ sourceId: `${tag}:workflow`, name: `${tag} Workflow` })
		.returning();
	workflowId = workflow.id;
	await db.insert(workflowStatuses).values(
		statusIds.map((statusId) => ({
			sourceId: `${tag}:ws:${statusId}`,
			workflowId,
			statusId,
		})),
	);
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project`,
			key: projectKey,
			name: `${tag} Desk`,
			projectType: "service_desk",
			lastIssueNumber: 0,
		})
		.returning();
	projectId = project.id;
	await db.insert(projectIssueTypes).values({
		sourceId: `${tag}:project-type`,
		projectId,
		issueTypeId,
	});
	await db.insert(projectWorkflows).values({
		sourceId: `${tag}:project-workflow`,
		projectId,
		issueTypeId: null,
		workflowId,
	});
	const [desk] = await db
		.insert(serviceDesks)
		.values({
			sourceId: `${tag}:desk`,
			projectId,
			portalName: `${tag} Portal`,
			openAccess: true,
		})
		.returning();
	deskId = desk.id;
	const [requestType] = await db
		.insert(requestTypes)
		.values({
			sourceId: `${tag}:request-type`,
			deskId,
			issueTypeId,
			name: `${tag} Request`,
			sequence: 0,
		})
		.returning();
	requestTypeId = requestType.id;
	await db.insert(requestTypeFields).values([
		{
			requestTypeId,
			fieldId: "summary",
			label: "Summary",
			required: true,
			sequence: 0,
		},
		{
			requestTypeId,
			fieldId: "description",
			label: "Details",
			required: false,
			sequence: 1,
		},
	]);
	const [calendar] = await db
		.insert(slaCalendars)
		.values({
			sourceId: `${tag}:calendar`,
			name: `${tag} 24/7`,
			timezone: "UTC",
			workingHours: week,
			holidays: [],
		})
		.returning();
	const [metric] = await db
		.insert(slaMetrics)
		.values({
			sourceId: `${tag}:metric`,
			deskId,
			name: `${tag} Time to resolution`,
			startConditions: [{ type: "issue_created" }],
			pauseConditions: [],
			stopConditions: [{ type: "resolution_set" }],
		})
		.returning();
	metricId = metric.id;
	await db.insert(slaGoals).values({
		sourceId: `${tag}:goal`,
		metricId,
		jql: "",
		goalMinutes: 60,
		calendarId: calendar.id,
		sequence: 0,
	});
});

afterAll(async () => {
	await stopMessengerWorker();
	await stopMessengerQueue();
	await cleanupTestData(run);
	await db.delete(projects).where(eq(projects.id, projectId));
	await db.delete(workflows).where(eq(workflows.id, workflowId));
	await db.delete(statuses).where(eq(statuses.id, statusIds[0]));
	await db.delete(statuses).where(eq(statuses.id, statusIds[1]));
	await db.delete(issueTypes).where(eq(issueTypes.id, issueTypeId));
	await db.delete(messengerConfig);
	await fake.close();
	await pool.end();
});

describe("administrator connection", () => {
	test("saves the token write-only and tests whoami", async () => {
		const saved = await inject(
			"PUT",
			"/api/admin/messenger/token",
			adminSession,
			{
				token: fake.token,
			},
		);
		expect(saved.statusCode).toBe(200);
		expect(saved.json().hasAccessToken).toBe(true);
		expect(saved.body).not.toContain(fake.token);

		const settings = await inject("PUT", "/api/admin/messenger", adminSession, {
			homeserverUrl: fake.url,
			serviceDeskId: deskId,
			requestTypeId,
			enabled: false,
		});
		expect(settings.statusCode).toBe(200);
		expect(settings.json().homeserverUrl).toBe(fake.url);

		for (const homeserverUrl of [
			"ftp://matrix.test",
			"javascript:alert(1)",
			"https://user:secret@matrix.test",
			"matrix.test",
		]) {
			const refused = await inject(
				"PUT",
				"/api/admin/messenger",
				adminSession,
				{
					homeserverUrl,
					serviceDeskId: deskId,
					requestTypeId,
					enabled: false,
				},
			);
			expect(refused.statusCode, homeserverUrl).toBe(400);
			expect(refused.body).not.toContain("secret");
		}

		const read = await inject("GET", "/api/admin/messenger", adminSession);
		expect(read.statusCode).toBe(200);
		expect(read.body).not.toContain(fake.token);

		const tested = await inject(
			"POST",
			"/api/admin/messenger/test",
			adminSession,
		);
		expect(tested.statusCode).toBe(200);
		expect(tested.json().userId).toBe(fake.botUserId);
		expect(tested.json().serverName).toBe("matrix.test");

		const audits = await db
			.select()
			.from(auditLog)
			.where(eq(auditLog.action, "messenger.settings.save"));
		expect(audits.length).toBeGreaterThan(0);
		expect(JSON.stringify(audits.map((row) => row.changes))).not.toContain(
			fake.token,
		);
	});
});

describe("sync worker", () => {
	test("the first sync stores the token and ignores old messages", async () => {
		const before = await db
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.projectId, projectId));
		fake.pushSync({
			rooms: {
				join: {
					[roomId]: {
						timeline: {
							events: [
								{
									type: "m.room.message",
									event_id: "$history",
									sender: `@t-${run}-alice:matrix.test`,
									content: { msgtype: "m.text", body: "!ticket Old history" },
								},
							],
						},
					},
				},
			},
		});
		const enabled = await inject("PUT", "/api/admin/messenger", adminSession, {
			homeserverUrl: fake.url,
			serviceDeskId: deskId,
			requestTypeId,
			enabled: true,
		});
		expect(enabled.statusCode).toBe(200);
		await fake.waitFor(() => fake.syncCount >= 1);
		await new Promise((resolve) => setTimeout(resolve, 300));
		const after = await db
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.projectId, projectId));
		expect(after.length).toBe(before.length);
	});

	test("a room joined after the first sync does not replay its history", async () => {
		const before = await db
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.projectId, projectId));
		fake.pushHistoryOnJoin(`!later-${run}:matrix.test`, [
			{
				type: "m.room.message",
				event_id: `$later-history-${run}`,
				sender: `@t-${run}-alice:matrix.test`,
				content: { msgtype: "m.text", body: "!ticket History after join" },
			},
		]);
		await new Promise((resolve) => setTimeout(resolve, 800));
		const after = await db
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.projectId, projectId));
		expect(after.length).toBe(before.length);
	});

	test("joins an invited room", async () => {
		fake.pushInvite(`!invite-${run}:matrix.test`);
		await fake.waitFor(() => fake.joins.includes(`!invite-${run}:matrix.test`));
	});

	test("sends one notice to an encrypted room", async () => {
		fake.pushInvite(encryptedRoomId, [
			{
				type: "m.room.encryption",
				content: { algorithm: "m.megolm.v1.aes-sha2" },
			},
		]);
		await fake.waitFor(() => fake.joins.includes(encryptedRoomId));
		await waitForSend((body) => body.includes("cannot read encrypted rooms"));
		const count = fake.sent.filter((item) =>
			String(item.content.body ?? "").includes("cannot read encrypted rooms"),
		).length;
		fake.pushJoinState(encryptedRoomId, [
			{
				type: "m.room.encryption",
				content: { algorithm: "m.megolm.v1.aes-sha2" },
			},
		]);
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(
			fake.sent.filter((item) =>
				String(item.content.body ?? "").includes("cannot read encrypted rooms"),
			).length,
		).toBe(count);
	});

	test("!ticket creates one request with the reporter, chat channel, SLA and a threaded answer", async () => {
		ticketRoot = `$cmd-ticket-${run}`;
		fake.pushTimeline(roomId, [
			{
				type: "m.room.message",
				event_id: ticketRoot,
				sender: `@t-${run}-alice:matrix.test`,
				content: {
					msgtype: "m.text",
					body: "!ticket Printer is broken\nIt shows a paper jam.",
				},
			},
		]);
		const body = await waitForSend((text) => text.startsWith("Created "));
		expect(body).toContain("Printer is broken");

		const [issue] = await db
			.select()
			.from(issues)
			.where(eq(issues.projectId, projectId))
			.limit(1);
		expect(issue.reporterId).toBe(aliceId);
		expect(issue.requestChannel).toBe("chat");
		expect(issue.requestTypeId).toBe(requestTypeId);
		ticketKey = issue.key;
		ticketIssueId = issue.id;
		const cycles = await db
			.select()
			.from(slaCycles)
			.where(eq(slaCycles.issueId, issue.id));
		expect(cycles.length).toBe(1);
		expect(cycles[0].metricId).toBe(metricId);

		const answer = fake.sent.find((item) => item.content.body === body);
		expect(answer?.content["m.relates_to"]).toMatchObject({
			rel_type: "m.thread",
			event_id: ticketRoot,
		});
		expect(body).toContain(
			`/servicedesk/customer/portal/${deskId}/${ticketKey}`,
		);
	});

	test("the same event delivered twice creates one request", async () => {
		const eventId = `$dedupe-${run}`;
		const event = {
			type: "m.room.message",
			event_id: eventId,
			sender: `@t-${run}-alice:matrix.test`,
			content: { msgtype: "m.text", body: "!ticket Deduplicated request" },
		};
		fake.pushTimeline(roomId, [event]);
		await waitForSend((text) => text.includes("Deduplicated request"));
		fake.pushTimeline(roomId, [event]);
		await new Promise((resolve) => setTimeout(resolve, 600));
		const rows = await db
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.summary, "Deduplicated request"));
		expect(rows.length).toBe(1);
	});

	test("a truncated sync is backfilled so no command is lost", async () => {
		const events = [1, 2, 3].map((number) => ({
			type: "m.room.message",
			event_id: `$limited-${number}-${run}`,
			sender: `@t-${run}-alice:matrix.test`,
			content: { msgtype: "m.text", body: `!help limited ${number}` },
		}));
		const before = fake.sent.length;
		fake.pushLimitedTimeline(roomId, events.slice(1), events.slice(0, 1));
		await fake.waitFor(() => fake.sent.length >= before + 3, 20_000);
		expect(
			fake.sent
				.slice(before)
				.filter((item) =>
					String(item.content.body ?? "").startsWith("Commands:"),
				).length,
		).toBe(3);
	});

	test("an unknown sender gets one connect notice per hour", async () => {
		const stranger = `@stranger-${run}:matrix.test`;
		const before = fake.sent.length;
		fake.pushTimeline(roomId, [
			{
				type: "m.room.message",
				event_id: `$stranger-1-${run}`,
				sender: stranger,
				content: { msgtype: "m.text", body: "!ticket Unknown sender" },
			},
		]);
		await fake.waitFor(() => fake.sent.length > before);
		const notice = fake.sent[before];
		expect(String(notice.content.body)).toContain("Connect to messenger");
		fake.pushTimeline(roomId, [
			{
				type: "m.room.message",
				event_id: `$stranger-2-${run}`,
				sender: stranger,
				content: { msgtype: "m.text", body: "!ticket Unknown sender again" },
			},
		]);
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(
			fake.sent.filter((item) =>
				String(item.content.body ?? "").includes("Connect to messenger"),
			).length,
		).toBe(1);
	});

	test("a linked id wins over the name rule", async () => {
		const codeResponse = await inject(
			"POST",
			"/api/profile/messenger",
			bobSession,
		);
		expect(codeResponse.statusCode).toBe(200);
		const code = codeResponse.json().code as string;
		const linked = await command(`@bob-${run}:other.test`, `!link ${code}`);
		expect(String(linked[0].content.body)).toContain("Connected");
		const [row] = await db
			.select({ messengerMatrixId: users.messengerMatrixId })
			.from(users)
			.where(eq(users.id, bobId));
		expect(row.messengerMatrixId).toBe(`@bob-${run}:other.test`);

		await command(`@bob-${run}:other.test`, "!ticket Linked sender request");
		const [issue] = await db
			.select()
			.from(issues)
			.where(eq(issues.summary, "Linked sender request"))
			.limit(1);
		expect(issue.reporterId).toBe(bobId);
	});

	test("!link refuses a wrong and an expired code", async () => {
		const wrong = await command(`@nobody-${run}:other.test`, "!link WRONGCODE");
		expect(String(wrong[0].content.body)).toContain("not valid");

		const codeResponse = await inject(
			"POST",
			"/api/profile/messenger",
			aliceSession,
		);
		const code = codeResponse.json().code as string;
		await db
			.update(messengerLinkCodes)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(messengerLinkCodes.code, code));
		const expired = await command(
			`@alice-other-${run}:other.test`,
			`!link ${code}`,
		);
		expect(String(expired[0].content.body)).toContain("expired");
	});

	test("!status respects the portal permission", async () => {
		const allowed = await command(
			`@t-${run}-alice:matrix.test`,
			`!status ${ticketKey}`,
		);
		expect(String(allowed[0].content.body)).toContain("Open");
		expect(String(allowed[0].content.body)).toContain(`/${ticketKey}`);

		const denied = await command(
			`@bob-${run}:other.test`,
			`!status ${ticketKey}`,
		);
		expect(String(denied[0].content.body)).toContain("Request not found");
	});

	test("status changes and public comments post to the thread, internal ones do not", async () => {
		const [issue] = await db
			.select()
			.from(issues)
			.where(eq(issues.id, ticketIssueId));
		const before = fake.sent.length;
		await recordIssueEvent({
			issue: {
				id: issue.id,
				key: issue.key,
				summary: issue.summary,
				reporterId: issue.reporterId,
				assigneeId: issue.assigneeId,
			},
			actor: { id: aliceId, displayName: "Alice Sender" },
			kind: "transitioned",
			changes: [{ field: "Status", from: "Open", to: "In Progress" }],
		});
		await waitForSend((body) => body.includes("is now In Progress"));
		const statusNotice = fake.sent
			.slice(before)
			.find((item) =>
				String(item.content.body ?? "").includes("is now In Progress"),
			);
		expect(statusNotice?.content["m.relates_to"]).toMatchObject({
			rel_type: "m.thread",
			event_id: ticketRoot,
		});

		const commentBefore = fake.sent.length;
		await recordIssueEvent({
			issue: {
				id: issue.id,
				key: issue.key,
				summary: issue.summary,
				reporterId: issue.reporterId,
				assigneeId: issue.assigneeId,
			},
			actor: { id: aliceId, displayName: "Alice Sender" },
			kind: "commented",
			commentHtml: "<p>Looking into the printer now.</p>",
		});
		await waitForSend((body) =>
			body.includes("commented: Looking into the printer now."),
		);
		expect(fake.sent.length).toBeGreaterThan(commentBefore);

		const internalBefore = fake.sent.length;
		await recordIssueEvent({
			issue: {
				id: issue.id,
				key: issue.key,
				summary: issue.summary,
				reporterId: issue.reporterId,
				assigneeId: issue.assigneeId,
			},
			actor: { id: aliceId, displayName: "Alice Sender" },
			kind: "commented",
			commentHtml: "<p>Internal secret note</p>",
			internal: true,
		});
		await new Promise((resolve) => setTimeout(resolve, 700));
		expect(
			fake.sent
				.slice(internalBefore)
				.some((item) =>
					String(item.content.body ?? "").includes("Internal secret"),
				),
		).toBe(false);
	});

	test("a thread reply becomes a comment and gets a reaction", async () => {
		const before = fake.sent.length;
		fake.pushTimeline(roomId, [
			{
				type: "m.room.message",
				event_id: `$reply-${run}`,
				sender: `@t-${run}-alice:matrix.test`,
				content: {
					msgtype: "m.text",
					body: "The jam is still there.",
					"m.relates_to": { rel_type: "m.thread", event_id: ticketRoot },
				},
			},
		]);
		await fake.waitFor(() =>
			fake.sent.slice(before).some((item) => item.eventType === "m.reaction"),
		);
		const reaction = fake.sent
			.slice(before)
			.find((item) => item.eventType === "m.reaction");
		expect(reaction?.content["m.relates_to"]).toMatchObject({
			rel_type: "m.annotation",
			key: "\u2705",
			event_id: `$reply-${run}`,
		});
		const rows = await db
			.select()
			.from(comments)
			.where(
				and(
					eq(comments.issueId, ticketIssueId),
					eq(comments.authorId, aliceId),
				),
			);
		expect(
			rows.some((row) => row.bodySource?.includes("jam is still there")),
		).toBe(true);
		expect(
			fake.sent
				.slice(before)
				.some(
					(item) =>
						item.eventType === "m.room.message" &&
						String(item.content.body ?? "").includes("jam is still there"),
				),
		).toBe(false);
	});

	test("a thread reply by a person without access is refused", async () => {
		const before = fake.sent.length;
		fake.pushTimeline(roomId, [
			{
				type: "m.room.message",
				event_id: `$noaccess-reply-${run}`,
				sender: `@bob-${run}:other.test`,
				content: {
					msgtype: "m.text",
					body: "I should not be able to comment",
					"m.relates_to": { rel_type: "m.thread", event_id: ticketRoot },
				},
			},
		]);
		await fake.waitFor(
			() =>
				fake.sent
					.slice(before)
					.some(
						(item) =>
							item.eventType === "m.room.message" &&
							item.content.body === "Request not found.",
					),
			15_000,
		);
	});

	test("a revoked token stops the worker instead of retrying", async () => {
		startMessengerWorker();
		await fake.waitFor(() => isMessengerWorkerRunning(), 10_000);
		fake.revoke();
		await fake.waitFor(() => !isMessengerWorkerRunning(), 15_000);
		const requests = fake.requests.length;
		await new Promise((resolve) => setTimeout(resolve, 1500));
		expect(fake.requests.length).toBe(requests);
		const [config] = await db
			.select()
			.from(messengerConfig)
			.where(eq(messengerConfig.id, 1));
		expect(config.lastError).toContain("Invalid access token");
		fake.revoked = false;
		startMessengerWorker();
		await fake.waitFor(() => isMessengerWorkerRunning(), 10_000);
	});

	test("the bot never answers its own messages", async () => {
		const before = fake.sent.length;
		const issuesBefore = await db
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.projectId, projectId));
		fake.pushTimeline(roomId, [
			{
				type: "m.room.message",
				event_id: `$self-${run}`,
				sender: fake.botUserId,
				content: { msgtype: "m.text", body: "!ticket Self request" },
			},
		]);
		await new Promise((resolve) => setTimeout(resolve, 600));
		expect(fake.sent.length).toBe(before);
		const issuesAfter = await db
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.projectId, projectId));
		expect(issuesAfter.length).toBe(issuesBefore.length);
	});

	test("limits one sender to five requests per ten minutes", async () => {
		const rateUser = `t-${run}-rate`;
		await db.insert(users).values({
			username: rateUser,
			displayName: "Rate Sender",
			active: true,
		});
		const before = fake.sent.length;
		fake.pushTimeline(
			roomId,
			[1, 2, 3, 4, 5, 6].map((number) => ({
				type: "m.room.message",
				event_id: `$rate-${number}-${run}`,
				sender: `@${rateUser}:matrix.test`,
				content: { msgtype: "m.text", body: `!ticket Rate request ${number}` },
			})),
		);
		await fake.waitFor(() => fake.sent.length >= before + 6, 20_000);
		const created = await db
			.select({ id: issues.id })
			.from(issues)
			.where(
				eq(
					issues.reporterId,
					(
						await pool.query<{ id: string }>(
							"select id from users where username = $1",
							[rateUser],
						)
					).rows[0].id,
				),
			);
		expect(created.length).toBe(5);
		expect(
			fake.sent
				.slice(before)
				.some((item) => String(item.content.body ?? "").includes("at most 5")),
		).toBe(true);
	});

	test("a command that fails after the event was marked is answered once and recorded", async () => {
		const issuesBefore = await deskIssueCount();
		const eventId = `$fail-ticket-${run}`;
		const event = {
			type: "m.room.message",
			event_id: eventId,
			sender: `@t-${run}-alice:matrix.test`,
			content: { msgtype: "m.text", body: "!ticket Broken\u0000summary" },
		};
		const before = fake.sent.length;
		fake.pushTimeline(roomId, [event]);
		const body = await waitForSend((text) =>
			text.includes("could not be created"),
		);
		expect(body).toContain("Send it again.");
		const answer = fake.sent
			.slice(before)
			.find((item) => item.content.body === body);
		expect(answer?.content["m.relates_to"]).toMatchObject({
			rel_type: "m.thread",
			event_id: eventId,
		});

		// Delivered again, the event is skipped: at most once, and no second answer.
		const count = fake.sent.length;
		fake.pushTimeline(roomId, [event]);
		await new Promise((resolve) => setTimeout(resolve, 600));
		expect(fake.sent.length).toBe(count);
		expect(await deskIssueCount()).toBe(issuesBefore);

		// Later clean syncs do not wipe the error.
		await command(`@t-${run}-alice:matrix.test`, "!help after a failure");
		await new Promise((resolve) => setTimeout(resolve, 300));
		const [config] = await db
			.select()
			.from(messengerConfig)
			.where(eq(messengerConfig.id, 1));
		expect(config.lastError).toContain("Could not process a chat message");
		expect(config.lastError).not.toContain(fake.token);
	});

	test("a very long description is cut so the stored text stays within the portal limit", async () => {
		await command(
			`@t-${run}-alice:matrix.test`,
			`!ticket Long description\n${"&".repeat(45_000)}`,
		);
		const [issue] = await db
			.select({ descriptionHtml: issues.descriptionHtml })
			.from(issues)
			.where(eq(issues.summary, "Long description"))
			.limit(1);
		expect(issue.descriptionHtml?.length).toBeGreaterThan(1000);
		expect(issue.descriptionHtml?.length).toBeLessThanOrEqual(200_000);
	});

	test("a thread reply that fails is answered in the thread", async () => {
		const before = fake.sent.length;
		fake.pushTimeline(roomId, [
			{
				type: "m.room.message",
				event_id: `$fail-reply-${run}`,
				sender: `@t-${run}-alice:matrix.test`,
				content: {
					msgtype: "m.text",
					body: "Bad\u0000comment",
					"m.relates_to": { rel_type: "m.thread", event_id: ticketRoot },
				},
			},
		]);
		await waitForSend((text) => text.includes("comment could not be added"));
		const answer = fake.sent
			.slice(before)
			.find((item) =>
				String(item.content.body ?? "").includes("comment could not be added"),
			);
		expect(answer?.content["m.relates_to"]).toMatchObject({
			rel_type: "m.thread",
			event_id: ticketRoot,
		});
	});

	test("every text the bot sends carries an empty mentions list", async () => {
		const sent = await command(`@t-${run}-alice:matrix.test`, "!help @room");
		expect(sent[0].content["m.mentions"]).toEqual({});
		expect(
			fake.sent
				.filter((item) => item.eventType === "m.room.message")
				.every((item) => item.content["m.mentions"] !== undefined),
		).toBe(true);
	});

	test("five wrong link codes lock one sender for ten minutes", async () => {
		const sender = `@limit-${run}:other.test`;
		for (let number = 1; number <= 5; number += 1) {
			const answer = await command(sender, `!link WRONG${number}`);
			expect(String(answer[0].content.body)).toContain("not valid");
		}
		const codeResponse = await inject(
			"POST",
			"/api/profile/messenger",
			aliceSession,
		);
		const code = codeResponse.json().code as string;
		const blocked = await command(sender, `!link ${code}`);
		expect(String(blocked[0].content.body)).toContain("Too many wrong codes");
		const [stillOpen] = await db
			.select({ usedAt: messengerLinkCodes.usedAt })
			.from(messengerLinkCodes)
			.where(eq(messengerLinkCodes.code, code));
		expect(stillOpen.usedAt).toBeNull();

		const other = await command(
			`@other-limit-${run}:other.test`,
			`!link ${code}`,
		);
		expect(String(other[0].content.body)).toContain("Connected");
	});

	test("two workers: only the advisory-lock holder syncs, the second takes over", async () => {
		await stopMessengerWorker();
		const first = createMessengerWorker();
		const second = createMessengerWorker();
		first.start();
		await fake.waitFor(() => first.isRunning(), 10_000);
		const count = fake.syncCount;
		second.start();
		await new Promise((resolve) => setTimeout(resolve, 800));
		expect(second.isRunning()).toBe(false);
		fake.pushSync({});
		await fake.waitFor(() => fake.syncCount > count);
		expect(second.isRunning()).toBe(false);

		await first.stop();
		await fake.waitFor(() => second.isRunning(), 10_000);
		const afterTakeover = fake.syncCount;
		fake.pushSync({});
		await fake.waitFor(() => fake.syncCount > afterTakeover);
		expect(second.isRunning()).toBe(true);
		await second.stop();
	}, 30_000);

	test("stopping the worker does not wait for a held long poll", async () => {
		startMessengerWorker();
		await fake.waitFor(() => isMessengerWorkerRunning(), 10_000);
		await new Promise((resolve) => setTimeout(resolve, 500));
		const started = Date.now();
		await stopMessengerWorker();
		expect(Date.now() - started).toBeLessThan(3000);
		expect(isMessengerWorkerRunning()).toBe(false);
	});

	test("disabling the connection stops the worker", async () => {
		startMessengerWorker();
		await fake.waitFor(() => isMessengerWorkerRunning(), 10_000);
		const disabled = await inject("PUT", "/api/admin/messenger", adminSession, {
			homeserverUrl: fake.url,
			serviceDeskId: deskId,
			requestTypeId,
			enabled: false,
		});
		expect(disabled.statusCode).toBe(200);
		await fake.waitFor(() => !isMessengerWorkerRunning(), 10_000);
		expect(isMessengerWorkerRunning()).toBe(false);
	});
});
