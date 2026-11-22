import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { SendMailOptions } from "nodemailer";
import nodemailer from "nodemailer";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, runMigrations } from "../src/lib/server/db.ts";
import { env } from "../src/lib/server/env.ts";
import {
	BATCH_WINDOW_MS,
	deliverEmailBatch,
	queueEmailEvents,
	renderNotificationMail,
	setEmailScheduler,
	setMailTransport,
	startEmailQueue,
	stopEmailQueue,
} from "../src/lib/server/mail.ts";
import {
	type BatchEvent,
	emailBatches,
	type NotificationKind,
	userSettings,
	users,
} from "../src/lib/server/schema.ts";

const run = randomUUID().slice(0, 8);
const issue = {
	id: randomUUID(),
	key: `MAIL${run.slice(0, 4).toUpperCase()}-1`,
	summary: "Pump pressure drops on the north line",
};

let userId: string;
let recipient: { id: string; email: string | null };

function event(kind: NotificationKind, extra: Partial<BatchEvent> = {}) {
	return {
		kind,
		actorId: null,
		actorName: "Avery Stone",
		changes: [],
		commentHtml: null,
		attachmentName: null,
		worklogSeconds: null,
		worklogComment: null,
		createdAt: new Date().toISOString(),
		...extra,
	} satisfies BatchEvent;
}

async function openBatches() {
	return db
		.select()
		.from(emailBatches)
		.where(eq(emailBatches.issueId, issue.id))
		.orderBy(emailBatches.sendAfter);
}

beforeAll(async () => {
	await runMigrations();
	const [user] = await db
		.insert(users)
		.values({
			username: `t-${run}-mail`,
			displayName: "Mail Recipient",
			email: `t-${run}-mail@example.test`,
		})
		.returning();
	userId = user.id;
	recipient = { id: user.id, email: user.email };
});

afterAll(async () => {
	await db.delete(users).where(eq(users.id, userId));
	setMailTransport(null);
});

test("events on one issue batch inside the window and split after it", async () => {
	setMailTransport({ sendMail: async () => ({}) });
	const start = new Date("2026-01-05T09:00:00.000Z");

	const first = await queueEmailEvents(
		recipient,
		issue,
		[event("commented")],
		["you are watching it"],
		start,
	);
	const second = await queueEmailEvents(
		recipient,
		issue,
		[event("updated")],
		["you are watching it"],
		new Date(start.getTime() + 30_000),
	);
	expect(second).toBe(first);

	const later = await queueEmailEvents(
		recipient,
		issue,
		[event("worklog_added", { worklogSeconds: 3600 })],
		["you are watching it"],
		new Date(start.getTime() + BATCH_WINDOW_MS + 1_000),
	);
	expect(later).not.toBe(first);

	const batches = await openBatches();
	expect(batches).toHaveLength(2);
	expect(batches[0].events.map((row) => row.kind)).toEqual([
		"commented",
		"updated",
	]);
	expect(batches[0].sendAfter.getTime()).toBe(
		start.getTime() + BATCH_WINDOW_MS,
	);
	expect(batches[1].events).toHaveLength(1);
});

test("appending to an open batch schedules the batch again", async () => {
	setMailTransport({ sendMail: async () => ({}) });
	const scheduled: { id: string; sendAfter: Date }[] = [];
	setEmailScheduler(async (batch) => {
		scheduled.push(batch);
	});
	const target = {
		id: randomUUID(),
		key: `MAILA-${run.slice(0, 4).toUpperCase()}`,
		summary: "Appended notification",
	};
	const start = new Date("2026-02-01T09:00:00.000Z");
	try {
		const first = await queueEmailEvents(
			recipient,
			target,
			[event("commented")],
			["you are watching it"],
			start,
		);
		const second = await queueEmailEvents(
			recipient,
			target,
			[event("updated")],
			["you are watching it"],
			new Date(start.getTime() + 30_000),
		);

		expect(second).toBe(first);
		expect(scheduled.map((batch) => batch.id)).toEqual([first, first]);
		expect(scheduled[1].sendAfter.getTime()).toBe(
			start.getTime() + BATCH_WINDOW_MS,
		);
	} finally {
		setEmailScheduler(null);
	}
});

test("a batch is delivered once with the issue thread headers", async () => {
	const stream = nodemailer.createTransport({
		streamTransport: true,
		buffer: true,
		newline: "unix",
	});
	let raw = "";
	const transport = {
		async sendMail(message: SendMailOptions) {
			const info = await stream.sendMail(message);
			raw = info.message.toString();
			return info;
		},
	};

	const [batch] = await openBatches();
	expect(await deliverEmailBatch(batch.id, { transport })).toBe("sent");

	const [headers] = raw.split("\n\n");
	const headerLines = headers.split("\n");
	expect(headerLines).toContain(`In-Reply-To: <rvna-${issue.id}@127.0.0.1>`);
	expect(headerLines).toContain(`References: <rvna-${issue.id}@127.0.0.1>`);
	expect(headerLines.some((line) => line.startsWith("Subject: "))).toBe(true);
	expect(raw).toContain("Avery Stone");

	const [stored] = await db
		.select()
		.from(emailBatches)
		.where(eq(emailBatches.id, batch.id));
	expect(stored.sentAt).not.toBeNull();

	expect(await deliverEmailBatch(batch.id, { transport })).toBe("skipped");
});

test("email off skips, plain text format omits the html part", async () => {
	const batchId = await queueEmailEvents(
		recipient,
		issue,
		[event("commented")],
		["you are watching it"],
	);
	expect(batchId).not.toBeNull();

	const sent: SendMailOptions[] = [];
	const transport = {
		async sendMail(message: SendMailOptions) {
			sent.push(message);
			return { messageId: "captured", envelope: {} };
		},
	};

	await db.insert(userSettings).values({ userId, emailNotifications: false });
	try {
		expect(await deliverEmailBatch(batchId as string, { transport })).toBe(
			"skipped",
		);
		expect(sent).toHaveLength(0);
	} finally {
		await db.delete(userSettings).where(eq(userSettings.userId, userId));
	}

	await db.insert(userSettings).values({ userId, emailFormat: "text" });
	try {
		expect(await deliverEmailBatch(batchId as string, { transport })).toBe(
			"sent",
		);
		expect(sent).toHaveLength(1);
		expect(sent[0].html).toBeUndefined();
		expect(sent[0].text).toContain("Pump pressure drops");
	} finally {
		await db.delete(userSettings).where(eq(userSettings.userId, userId));
	}
});

test("a hostile summary is escaped and cannot inject headers", () => {
	const summary =
		'Fix <script>alert("x")</script> & "quotes"\r\nBcc: evil@example.test';
	const mail = renderNotificationMail({
		appUrl: "http://127.0.0.1:3300",
		issue: {
			id: "00000000-0000-4000-8000-000000000000",
			key: "MAIL-1",
			summary,
		},
		events: [
			event("commented", {
				commentHtml:
					'<p>Look at <a class="user-hover" data-user-id="x">@Ada</a></p>',
			}),
		],
		reasons: ["you are watching it"],
		format: "html",
	});

	expect(mail.subject).not.toMatch(/[\r\n]/);
	expect(mail.subject).toContain("Bcc: evil@example.test");
	expect(mail.html).toContain("&lt;script&gt;");
	expect(mail.html).not.toContain("<script>");
	expect(mail.html).toContain('class="user-hover"');
	expect(mail.headers["In-Reply-To"]).toBe(
		"<rvna-00000000-0000-4000-8000-000000000000@127.0.0.1>",
	);
	expect(mail.html).toMatchSnapshot();
	expect(mail.text).toMatchSnapshot();
});

test("a summary with CR/LF never becomes a header line", async () => {
	const transport = nodemailer.createTransport({
		streamTransport: true,
		buffer: true,
		newline: "unix",
	});
	const mail = renderNotificationMail({
		appUrl: "http://127.0.0.1:3300",
		issue: {
			...issue,
			summary: "Injected\r\nBcc: evil@example.test\nX-Evil: yes",
		},
		events: [event("updated")],
		reasons: ["you reported it"],
		format: "html",
	});

	const info = await transport.sendMail({
		from: env.MAIL_FROM,
		to: recipient.email as string,
		...mail,
	});
	const raw = info.message.toString();
	const headerBlock = raw.split("\n\n")[0];
	const headerLines = headerBlock.split("\n");
	expect(headerLines.some((line) => /^bcc:/i.test(line))).toBe(false);
	expect(headerLines.some((line) => /^x-evil:/i.test(line))).toBe(false);
	expect(headerLines.filter((line) => /^to:/i.test(line))).toHaveLength(1);
});

test("no SMTP transport means nothing is queued or sent", async () => {
	setMailTransport(null);
	const before = (await openBatches()).length;
	const batchId = await queueEmailEvents(
		recipient,
		issue,
		[event("commented")],
		["you are watching it"],
	);
	expect(batchId).toBeNull();
	expect((await openBatches()).length).toBe(before);
	expect(await deliverEmailBatch(randomUUID())).toBe("skipped");
});

test("a failed send is retried by the queue and delivered once", {
	timeout: 60_000,
}, async () => {
	setMailTransport({ sendMail: async () => ({}) });
	const batchId = await queueEmailEvents(
		recipient,
		issue,
		[event("attachment_added", { attachmentName: "report.pdf" })],
		["it is assigned to you"],
		new Date(Date.now() - BATCH_WINDOW_MS),
	);
	expect(batchId).not.toBeNull();

	let attempts = 0;
	const delivered: unknown[] = [];
	const flaky = {
		async sendMail(message: unknown) {
			attempts += 1;
			if (attempts === 1) throw new Error("smtp is down");
			delivered.push(message);
			return { messageId: "retry-ok", envelope: {} };
		},
	};

	const queue = "notification-email-retry-test";
	const boss = new PgBoss({ connectionString: env.DATABASE_URL, max: 2 });
	await boss.start();
	try {
		await boss.createQueue(queue, { retryLimit: 2, retryDelay: 0 });
		await boss.work<{ batchId: string }>(
			queue,
			{ batchSize: 1, pollingIntervalSeconds: 0.5 },
			async ([job]) => {
				await deliverEmailBatch(job.data.batchId, { transport: flaky });
			},
		);
		await boss.send(
			queue,
			{ batchId: batchId as string },
			{ startAfter: new Date(), retryLimit: 2, retryDelay: 0 },
		);

		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			if (attempts >= 2 && delivered.length === 1) break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		expect(attempts).toBe(2);
		expect(delivered).toHaveLength(1);
		// sendMail resolves before the worker marks the batch; wait for that write.
		const marked = Date.now() + 15_000;
		let stored = (
			await db
				.select()
				.from(emailBatches)
				.where(eq(emailBatches.id, batchId as string))
		)[0];
		while (stored?.sentAt === null && Date.now() < marked) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			stored = (
				await db
					.select()
					.from(emailBatches)
					.where(eq(emailBatches.id, batchId as string))
			)[0];
		}
		expect(stored?.sentAt).not.toBeNull();
	} finally {
		await boss.stop({ graceful: false, close: true });
	}
});

test("the queue picks up batches left over from a restart", {
	timeout: 60_000,
}, async () => {
	setMailTransport({ sendMail: async () => ({}) });
	const recoveryIssue = {
		id: randomUUID(),
		key: "MAILR-1",
		summary: "Recovered notification",
	};
	const batchId = await queueEmailEvents(
		recipient,
		recoveryIssue,
		[event("commented")],
		["you are watching it"],
		new Date(Date.now() - BATCH_WINDOW_MS),
	);
	expect(batchId).not.toBeNull();

	const sent: SendMailOptions[] = [];
	await startEmailQueue({
		async sendMail(message: SendMailOptions) {
			sent.push(message);
			return { messageId: "recovered" };
		},
	});
	try {
		const deadline = Date.now() + 20_000;
		while (
			Date.now() < deadline &&
			!sent.some((message) =>
				String(message.text).includes(recoveryIssue.summary),
			)
		) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const recovered = sent.filter((message) =>
			String(message.text).includes(recoveryIssue.summary),
		);
		expect(recovered).toHaveLength(1);
		// The worker marks the batch sent after sendMail returns, so wait for it.
		const readBatch = async () =>
			(
				await db
					.select()
					.from(emailBatches)
					.where(eq(emailBatches.id, batchId as string))
			)[0];
		const marked = Date.now() + 15_000;
		let stored = await readBatch();
		while (stored?.sentAt === null && Date.now() < marked) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			stored = await readBatch();
		}
		expect(stored?.sentAt).not.toBeNull();
	} finally {
		await stopEmailQueue();
	}
});
