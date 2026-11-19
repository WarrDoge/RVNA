import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { SendMailOptions } from "nodemailer";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, runMigrations } from "../src/lib/server/db.ts";
import {
	BATCH_WINDOW_MS,
	deliverEmailBatch,
	queueEmailEvents,
	redirectMessage,
	setMailTransport,
} from "../src/lib/server/mail.ts";
import { type BatchEvent, users } from "../src/lib/server/schema.ts";

// The env proxy parses lazily, so this is in place before the first mail read.
process.env.MAIL_REDIRECT_TO = "redirect@example.test";

const run = randomUUID().slice(0, 8);
const issue = {
	id: randomUUID(),
	key: `REDIR${run.slice(0, 4).toUpperCase()}-1`,
	summary: "Redirected notification",
};
let userId: string;
let recipient: { id: string; email: string | null };

const event: BatchEvent = {
	kind: "commented",
	actorId: null,
	actorName: "Avery Stone",
	changes: [],
	commentHtml: null,
	attachmentName: null,
	worklogSeconds: null,
	worklogComment: null,
	createdAt: new Date().toISOString(),
};

beforeAll(async () => {
	await runMigrations();
	const [user] = await db
		.insert(users)
		.values({
			username: `t-${run}-redirect`,
			displayName: "Real Recipient",
			email: `t-${run}-real@example.test`,
		})
		.returning();
	userId = user.id;
	recipient = { id: user.id, email: user.email };
	setMailTransport({ sendMail: async () => ({}) });
});

afterAll(async () => {
	await db.delete(users).where(eq(users.id, userId));
	setMailTransport(null);
	delete process.env.MAIL_REDIRECT_TO;
});

test("MAIL_REDIRECT_TO sends to the safety address and names the original", async () => {
	const batchId = await queueEmailEvents(
		recipient,
		issue,
		[event],
		["you are watching it"],
		new Date(Date.now() - BATCH_WINDOW_MS),
	);
	expect(batchId).not.toBeNull();

	const sent: SendMailOptions[] = [];
	const transport = {
		async sendMail(message: SendMailOptions) {
			sent.push(message);
			return { messageId: "redirected", envelope: {} };
		},
	};
	expect(await deliverEmailBatch(batchId as string, { transport })).toBe(
		"sent",
	);

	expect(sent).toHaveLength(1);
	const message = sent[0];
	expect(message.to).toBe("redirect@example.test");
	expect((message.headers as Record<string, string>)["X-Original-To"]).toBe(
		recipient.email,
	);
	expect(String(message.text).split("\n")[0]).toBe(
		`Originally addressed to: ${recipient.email}`,
	);
	const html = String(message.html);
	expect(html).toMatch(
		new RegExp(
			`<body[^>]*><p [^>]*>Originally addressed to: ${recipient.email}</p>`,
		),
	);
});

test("an explicit null redirect keeps the real recipient", async () => {
	const batchId = await queueEmailEvents(
		recipient,
		issue,
		[{ ...event, kind: "updated" }],
		["it is assigned to you"],
		new Date(Date.now() - BATCH_WINDOW_MS),
	);
	expect(batchId).not.toBeNull();

	const sent: SendMailOptions[] = [];
	const transport = {
		async sendMail(message: SendMailOptions) {
			sent.push(message);
			return { messageId: "direct", envelope: {} };
		},
	};
	expect(
		await deliverEmailBatch(batchId as string, {
			transport,
			redirectTo: null,
		}),
	).toBe("sent");
	expect(sent[0].to).toBe(recipient.email);
	expect(
		(sent[0].headers as Record<string, string>)["X-Original-To"],
	).toBeUndefined();
});

test("the redirect drops every other recipient and a custom envelope", () => {
	const redirected = redirectMessage(
		{
			to: "real@example.test",
			cc: "cc@example.test",
			bcc: "bcc@example.test",
			envelope: { from: "a@example.test", to: ["env@example.test"] },
			text: "Body",
		},
		"redirect@example.test",
	);
	expect(redirected.to).toBe("redirect@example.test");
	expect(redirected.cc).toBeUndefined();
	expect(redirected.bcc).toBeUndefined();
	expect(redirected.envelope).toBeUndefined();
});
