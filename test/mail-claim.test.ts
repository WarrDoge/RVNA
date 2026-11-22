import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { SendMailOptions } from "nodemailer";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	deliverEmailBatch,
	queueEmailEvents,
	setMailTransport,
} from "../src/lib/server/mail.ts";
import {
	type BatchEvent,
	emailBatches,
	users,
} from "../src/lib/server/schema.ts";

const run = randomUUID().slice(0, 8);
let userId: string;
let recipient: { id: string; email: string | null };

function event(kind: BatchEvent["kind"]): BatchEvent {
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
	};
}

function issue(label: string) {
	return {
		id: randomUUID(),
		key: `MAILC-${label}`,
		summary: `Claim test ${label}`,
	};
}

async function batchesFor(issueId: string) {
	return db
		.select()
		.from(emailBatches)
		.where(eq(emailBatches.issueId, issueId))
		.orderBy(emailBatches.createdAt);
}

beforeAll(async () => {
	await runMigrations();
	const [user] = await db
		.insert(users)
		.values({
			username: `t-${run}-mail-claim`,
			displayName: "Mail Claim",
			email: `t-${run}-mail-claim@example.test`,
		})
		.returning();
	userId = user.id;
	recipient = { id: user.id, email: user.email };
});

afterAll(async () => {
	await db.delete(emailBatches).where(eq(emailBatches.userId, userId));
	await db.delete(users).where(eq(users.id, userId));
	setMailTransport(null);
	await pool.end();
});

test("an event appended while a batch is sent is not lost", async () => {
	const target = issue("APPEND");
	const transport = {
		async sendMail(_message: SendMailOptions) {
			await queueEmailEvents(
				recipient,
				target,
				[event("updated")],
				["you are watching it"],
			);
			return {};
		},
	};
	setMailTransport(transport);

	const first = await queueEmailEvents(
		recipient,
		target,
		[event("commented")],
		["you are watching it"],
	);
	expect(first).not.toBeNull();
	expect(await deliverEmailBatch(first as string, { transport })).toBe("sent");

	const batches = await batchesFor(target.id);
	expect(batches).toHaveLength(2);
	expect(batches.filter((batch) => batch.sentAt !== null)).toHaveLength(1);
	expect(batches.filter((batch) => batch.sentAt === null)).toHaveLength(1);
});

test("two workers deliver one batch once", async () => {
	const target = issue("ONCE");
	let sends = 0;
	const transport = {
		async sendMail(_message: SendMailOptions) {
			sends += 1;
			await new Promise((resolve) => setTimeout(resolve, 100));
			return {};
		},
	};
	setMailTransport(transport);

	const batchId = await queueEmailEvents(
		recipient,
		target,
		[event("commented")],
		["you are watching it"],
	);
	expect(batchId).not.toBeNull();

	const results = await Promise.all([
		deliverEmailBatch(batchId as string, { transport }),
		deliverEmailBatch(batchId as string, { transport }),
	]);
	expect(sends).toBe(1);
	expect(results.filter((result) => result === "sent")).toHaveLength(1);
});
