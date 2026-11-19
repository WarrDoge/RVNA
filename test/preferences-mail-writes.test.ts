import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { queueEmailEvents, setMailTransport } from "../src/lib/server/mail.ts";
import {
	emailBatches,
	userPreferences,
	users,
} from "../src/lib/server/schema.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const tag = `test-${run}`;

let app: TestApp;
let session: string;
let mailUserId: string;
const mailIssue = {
	id: randomUUID(),
	key: `MB${run.slice(0, 4).toUpperCase()}-1`,
	summary: "Concurrent mail batching",
};

function inject(
	method: "GET" | "PUT",
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

function mailEvent() {
	return {
		kind: "commented" as const,
		actorId: null,
		actorName: "Mail Test",
		changes: [],
		commentHtml: null,
		attachmentName: null,
		worklogSeconds: null,
		worklogComment: null,
		createdAt: new Date().toISOString(),
	};
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();

	const result = await login(app, {
		sub: `${tag}-user`,
		username: `t-${run}-user`,
		name: "Preferences User",
		email: `t-${run}-user@example.test`,
		groups: [],
	});
	session = result.sessionId as string;

	const [mailUser] = await db
		.insert(users)
		.values({
			username: `t-${run}-mail`,
			displayName: "Mail Batch User",
			email: `t-${run}-mail@example.test`,
		})
		.returning();
	mailUserId = mailUser.id;
});

afterAll(async () => {
	await db.delete(emailBatches).where(eq(emailBatches.issueId, mailIssue.id));
	await db
		.delete(userPreferences)
		.where(eq(userPreferences.userId, mailUserId));
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("two tabs saving different notification settings keep both", async () => {
	const responses = await Promise.all([
		inject("PUT", "/api/me/notification-settings", session, {
			emailNotifications: false,
		}),
		inject("PUT", "/api/me/notification-settings", session, {
			emailFormat: "text",
		}),
		inject("PUT", "/api/me/notification-settings", session, {
			autoWatch: false,
		}),
		inject("PUT", "/api/me/notification-settings", session, {
			notifyOwnChanges: true,
		}),
	]);
	for (const response of responses) {
		expect(response.statusCode).toBe(200);
	}

	const saved = await inject("GET", "/api/me/notification-settings", session);
	expect(saved.json()).toEqual({
		emailNotifications: false,
		notifyOwnChanges: true,
		autoWatch: false,
		emailFormat: "text",
	});
});

test("two tabs saving different navigator preferences keep both", async () => {
	const responses = await Promise.all([
		inject("PUT", "/api/navigator/preferences", session, {
			view: "detail",
		}),
		inject("PUT", "/api/navigator/preferences", session, {
			columns: ["key", "summary"],
		}),
	]);
	for (const response of responses) {
		expect(response.statusCode).toBe(200);
	}

	const saved = await inject("GET", "/api/navigator/preferences", session);
	expect(saved.json()).toEqual({
		view: "detail",
		columns: ["key", "summary"],
	});
});

test("concurrent events create one open email batch", async () => {
	setMailTransport({ sendMail: async () => ({}) });
	const now = new Date("2026-03-01T09:00:00.000Z");
	const ids = await Promise.all(
		Array.from({ length: 20 }, () =>
			queueEmailEvents(
				{ id: mailUserId, email: `t-${run}-mail@example.test` },
				mailIssue,
				[mailEvent()],
				["you are watching it"],
				now,
			),
		),
	);
	expect(new Set(ids).size).toBe(1);

	const batches = await db
		.select()
		.from(emailBatches)
		.where(eq(emailBatches.issueId, mailIssue.id));
	expect(batches).toHaveLength(1);
	expect(batches[0].events).toHaveLength(20);
});
