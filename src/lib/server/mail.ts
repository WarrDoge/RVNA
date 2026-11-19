import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { SendMailOptions } from "nodemailer";
import nodemailer from "nodemailer";
import { getBoss, stopBoss } from "./boss.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { escapeHtml, htmlToText } from "./html.ts";
import { notificationAction } from "./notification-text.ts";
import {
	type BatchEvent,
	emailBatches,
	userSettings,
	users,
} from "./schema.ts";

export const EMAIL_QUEUE = "notification-email";
export const BATCH_WINDOW_MS = 60_000;

export type MailTransport = {
	sendMail(message: SendMailOptions): Promise<unknown>;
};

export type NotificationMail = {
	subject: string;
	html: string;
	text: string;
	headers: Record<string, string>;
};

export type MailIssue = { id: string; key: string; summary: string };

let transport: MailTransport | null = null;

export function mailEnabled() {
	return transport !== null;
}

export function setMailTransport(next: MailTransport | null) {
	transport = next;
}

export function createSmtpTransport(): MailTransport | null {
	if (!env.SMTP_URL) return null;
	return nodemailer.createTransport(env.SMTP_URL);
}

export type EmailScheduler = (batch: {
	id: string;
	sendAfter: Date;
}) => Promise<void>;

let scheduler: EmailScheduler | null = null;

export function setEmailScheduler(next: EmailScheduler | null) {
	scheduler = next;
}

// Batching keeps the mail count down and the pg-boss job keeps SMTP off the request path.
export async function queueEmailEvents(
	recipient: { id: string; email: string | null },
	issue: MailIssue,
	events: BatchEvent[],
	reasons: string[],
	now = new Date(),
): Promise<string | null> {
	if (!mailEnabled() || !recipient.email || events.length === 0) return null;

	const result = await db.transaction(async (tx) => {
		// Serialize the find-or-create so two events for one recipient and issue
		// cannot both open a batch.
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${recipient.id} || ':' || ${issue.id}, 0))`,
		);
		const windowStart = new Date(now.getTime() - BATCH_WINDOW_MS);
		const [open] = await tx
			.select({ id: emailBatches.id })
			.from(emailBatches)
			.where(
				and(
					eq(emailBatches.userId, recipient.id),
					eq(emailBatches.issueId, issue.id),
					isNull(emailBatches.sentAt),
					gt(emailBatches.createdAt, windowStart),
				),
			)
			.orderBy(desc(emailBatches.createdAt))
			.limit(1);

		if (open) {
			const [appended] = await tx
				.update(emailBatches)
				.set({
					events: sql`${emailBatches.events} || ${JSON.stringify(events)}::jsonb`,
					reasons: sql`${emailBatches.reasons} || ${JSON.stringify(reasons)}::jsonb`,
				})
				.where(and(eq(emailBatches.id, open.id), isNull(emailBatches.sentAt)))
				.returning({ id: emailBatches.id });
			if (appended) {
				return { id: appended.id, created: false, sendAfter: null };
			}
		}

		const sendAfter = new Date(now.getTime() + BATCH_WINDOW_MS);
		const [created] = await tx
			.insert(emailBatches)
			.values({
				userId: recipient.id,
				issueId: issue.id,
				issueKey: issue.key,
				issueSummary: issue.summary,
				events,
				reasons,
				sendAfter,
				createdAt: now,
			})
			.returning({ id: emailBatches.id });
		return { id: created.id, created: true, sendAfter };
	});

	if (result.created && result.sendAfter) {
		try {
			await scheduler?.({ id: result.id, sendAfter: result.sendAfter });
		} catch (error) {
			console.error("notification email: could not enqueue a batch", error);
		}
	}

	return result.id;
}

/**
 * A non-production instance can hold real addresses while SMTP points at a test server.
 * Redirect every message there and keep the original envelope recipient visible.
 */
export function redirectMessage(message: SendMailOptions, redirectTo: string) {
	const original = singleLine(String(message.to ?? ""));
	const notice = `Originally addressed to: ${original}`;
	const redirected: SendMailOptions = {
		...message,
		to: redirectTo,
		// No other recipient may stay: the envelope is built from all three.
		cc: undefined,
		bcc: undefined,
		envelope: undefined,
		text: message.text ? `${notice}\n\n${message.text}` : notice,
		headers: {
			...(message.headers as Record<string, string> | undefined),
			"X-Original-To": original,
		},
	};
	if (typeof message.html === "string") {
		const paragraph = `<p style="margin:0 0 12px;font-size:14px;line-height:20px;color:#172b4d">${escapeHtml(notice)}</p>`;
		redirected.html = /<body[^>]*>/i.test(message.html)
			? message.html.replace(/<body([^>]*)>/i, (tag) => `${tag}${paragraph}`)
			: `${paragraph}${message.html}`;
	}
	return redirected;
}

export async function deliverEmailBatch(
	batchId: string,
	options: {
		transport?: MailTransport | null;
		appUrl?: string;
		redirectTo?: string | null;
	} = {},
): Promise<"sent" | "skipped"> {
	const sender = options.transport ?? transport;
	if (!sender) return "skipped";

	const [batch] = await db
		.select()
		.from(emailBatches)
		.where(eq(emailBatches.id, batchId))
		.limit(1);
	if (!batch || batch.sentAt) return "skipped";

	const [recipient] = await db
		.select({
			email: users.email,
			emailNotifications: userSettings.emailNotifications,
			emailFormat: userSettings.emailFormat,
		})
		.from(users)
		.leftJoin(userSettings, eq(userSettings.userId, users.id))
		.where(and(eq(users.id, batch.userId), eq(users.active, true)))
		.limit(1);

	if (!recipient?.email || recipient.emailNotifications === false) {
		return "skipped";
	}

	const format = recipient.emailFormat ?? "html";
	const mail = renderNotificationMail({
		appUrl: options.appUrl ?? env.APP_URL,
		issue: {
			id: batch.issueId,
			key: batch.issueKey,
			summary: batch.issueSummary,
		},
		events: batch.events,
		reasons: [...new Set(batch.reasons)],
		format,
	});

	const message: SendMailOptions = {
		from: env.MAIL_FROM,
		to: recipient.email,
		subject: mail.subject,
		text: mail.text,
		headers: mail.headers,
	};
	if (format === "html") message.html = mail.html;

	const redirectTo =
		options.redirectTo === undefined
			? env.MAIL_REDIRECT_TO
			: options.redirectTo;
	await sender.sendMail(
		redirectTo ? redirectMessage(message, redirectTo) : message,
	);

	await db
		.update(emailBatches)
		.set({ sentAt: new Date() })
		.where(and(eq(emailBatches.id, batch.id), isNull(emailBatches.sentAt)));

	return "sent";
}

function singleLine(value: string) {
	return value
		.replace(/[\r\n\u2028\u2029]+/g, " ")
		.replace(/\p{Cc}/gu, "")
		.trim();
}

function formatDuration(seconds: number) {
	const total = Math.max(0, Math.round(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
	if (hours > 0) return `${hours}h`;
	if (minutes > 0) return `${minutes}m`;
	return `${total}s`;
}

function joinReasons(reasons: string[]) {
	const list = reasons.length > 0 ? reasons : ["you are watching this issue"];
	if (list.length === 1) return list[0];
	return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function changesTable(event: BatchEvent, cell: (value: string) => string) {
	if (event.changes.length === 0) return "";
	const rows = event.changes
		.map(
			(change) =>
				`<tr><td style="padding:6px 10px;border:1px solid #dfe1e6;color:#172b4d">${cell(change.field)}</td><td style="padding:6px 10px;border:1px solid #dfe1e6;color:#172b4d">${cell(change.from ?? "None")}</td><td style="padding:6px 10px;border:1px solid #dfe1e6;color:#172b4d">${cell(change.to ?? "None")}</td></tr>`,
		)
		.join("");
	return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 12px;font-size:14px;line-height:20px"><thead><tr><th align="left" style="padding:6px 10px;border:1px solid #dfe1e6;background:#f4f5f7;color:#6b778c;font-size:12px">Field</th><th align="left" style="padding:6px 10px;border:1px solid #dfe1e6;background:#f4f5f7;color:#6b778c;font-size:12px">From</th><th align="left" style="padding:6px 10px;border:1px solid #dfe1e6;background:#f4f5f7;color:#6b778c;font-size:12px">To</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function eventText(event: BatchEvent, issueKey: string) {
	const lines = [
		`${event.actorName} ${notificationAction(event.kind)} ${issueKey}`,
	];
	for (const change of event.changes) {
		lines.push(
			`  ${change.field}: ${change.from ?? "None"} -> ${change.to ?? "None"}`,
		);
	}
	if (event.commentHtml) lines.push("", htmlToText(event.commentHtml));
	if (event.attachmentName) lines.push(`Attached: ${event.attachmentName}`);
	if (event.worklogSeconds !== null) {
		const comment = event.worklogComment
			? ` (${singleLine(event.worklogComment)})`
			: "";
		lines.push(
			`Logged work: ${formatDuration(event.worklogSeconds)}${comment}`,
		);
	}
	return lines.join("\n");
}

function eventHtml(event: BatchEvent, issueUrl: string, issueKey: string) {
	const actor = escapeHtml(event.actorName);
	const parts = [
		`<p style="margin:0 0 10px;font-size:14px;line-height:20px;color:#172b4d"><strong>${actor}</strong> ${notificationAction(event.kind)} <a href="${escapeHtml(issueUrl)}" style="color:#0052cc;text-decoration:none">${escapeHtml(issueKey)}</a></p>`,
	];

	const table = changesTable(event, escapeHtml);
	if (table) parts.push(table);

	if (event.commentHtml) {
		parts.push(
			`<div style="margin:0 0 12px;padding:10px 12px;border-left:3px solid #dfe1e6;font-size:14px;line-height:20px;color:#172b4d">${event.commentHtml}</div>`,
		);
	}
	if (event.attachmentName) {
		parts.push(
			`<p style="margin:0 0 12px;font-size:14px;color:#172b4d">Attached <strong>${escapeHtml(event.attachmentName)}</strong></p>`,
		);
	}
	if (event.worklogSeconds !== null) {
		const comment = event.worklogComment
			? ` — ${escapeHtml(event.worklogComment)}`
			: "";
		parts.push(
			`<p style="margin:0 0 12px;font-size:14px;color:#172b4d">Logged work: ${formatDuration(event.worklogSeconds)}${comment}</p>`,
		);
	}

	return parts.join("");
}

export function renderNotificationMail(input: {
	appUrl: string;
	issue: MailIssue;
	events: BatchEvent[];
	reasons: string[];
	format: "html" | "text";
}): NotificationMail {
	const appUrl = input.appUrl.replace(/\/+$/, "");
	const issueUrl = `${appUrl}/browse/${encodeURIComponent(input.issue.key)}`;
	const settingsUrl = `${appUrl}/secure/ViewProfile.jspa?selectedTab=notifications`;
	const summary = singleLine(input.issue.summary);
	const subject = `[RVNA] (${input.issue.key}) ${summary}`;
	const host = new URL(appUrl).hostname;
	const threadId = `<rvna-${input.issue.id}@${host}>`;

	const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #dfe1e6">
<tr><td style="padding:16px 20px;background:#0052cc">
<a href="${escapeHtml(issueUrl)}" style="color:#ffffff;font-size:16px;font-weight:600;text-decoration:none">${escapeHtml(input.issue.key)}</a>
<span style="color:#deebff;font-size:16px"> ${escapeHtml(summary)}</span>
</td></tr>
<tr><td style="padding:20px">
${input.events.map((event) => eventHtml(event, issueUrl, input.issue.key)).join("")}
</td></tr>
<tr><td style="padding:16px 20px;border-top:1px solid #dfe1e6;font-size:12px;line-height:18px;color:#6b778c">
<p style="margin:0 0 6px">You are receiving this because ${escapeHtml(joinReasons(input.reasons))}.</p>
<p style="margin:0">Manage your <a href="${escapeHtml(settingsUrl)}" style="color:#0052cc">notification settings</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

	const text = [
		`${input.issue.key} ${summary}`,
		issueUrl,
		"",
		...input.events.map((event) => `${eventText(event, input.issue.key)}\n`),
		`You are receiving this because ${joinReasons(input.reasons)}.`,
		`Manage your notification settings: ${settingsUrl}`,
	].join("\n");

	return {
		subject,
		html,
		text,
		headers: { "In-Reply-To": threadId, References: threadId },
	};
}

export async function startEmailQueue(sender: MailTransport) {
	const instance = await getBoss();
	await instance.createQueue(EMAIL_QUEUE, {
		retryLimit: 5,
		retryDelay: 30,
		retryBackoff: true,
		expireInSeconds: 120,
		retentionSeconds: 24 * 60 * 60,
	});
	await instance.work<{ batchId: string }>(
		EMAIL_QUEUE,
		{ batchSize: 1, pollingIntervalSeconds: 2 },
		async ([job]) => {
			await deliverEmailBatch(job.data.batchId, { transport: sender });
		},
	);

	setEmailScheduler(async ({ id, sendAfter }) => {
		await instance.send(
			EMAIL_QUEUE,
			{ batchId: id },
			{ startAfter: sendAfter, singletonKey: id },
		);
	});

	// Batches written while the queue was down have no job; a sent batch skips on delivery.
	const pending = await db
		.select({ id: emailBatches.id, sendAfter: emailBatches.sendAfter })
		.from(emailBatches)
		.where(isNull(emailBatches.sentAt));
	const now = new Date();
	for (const batch of pending) {
		await instance.send(
			EMAIL_QUEUE,
			{ batchId: batch.id },
			{
				startAfter: batch.sendAfter > now ? batch.sendAfter : now,
				singletonKey: batch.id,
			},
		);
	}
}

export async function startMail(
	sender: MailTransport,
	start: (sender: MailTransport) => Promise<void> = startEmailQueue,
): Promise<boolean> {
	try {
		await start(sender);
		setMailTransport(sender);
		return true;
	} catch (error) {
		setMailTransport(null);
		console.error("notification email queue: could not start", error);
		return false;
	}
}

export async function stopEmailQueue() {
	setEmailScheduler(null);
	await stopBoss();
}
