import { eq } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { getBoss, stopBoss } from "../boss.ts";
import { db } from "../db.ts";
import { htmlToText } from "../html.ts";
import { issues, messengerThreads, statuses } from "../schema.ts";
import { deskByProjectId } from "../servicedesk/access.ts";
import { matrixSendText } from "./client.ts";
import { messengerSettings } from "./config.ts";
import { portalRequestLink, truncate } from "./text.ts";

export const MESSENGER_QUEUE = "messenger-notice";
const COMMENT_LIMIT = 300;

export type MessengerNotice =
	| { kind: "status"; issueId: string; status: string }
	| { kind: "comment"; issueId: string; actorName: string; html: string };

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function start() {
	const instance = await getBoss();
	await instance.createQueue(MESSENGER_QUEUE, {
		retryLimit: 5,
		retryDelay: 5,
		retryBackoff: true,
		expireInSeconds: 300,
	});
	await instance.work<MessengerNotice>(
		MESSENGER_QUEUE,
		{ pollingIntervalSeconds: 0.5 },
		async (jobs: Job<MessengerNotice>[]) => {
			for (const job of jobs) {
				await deliverMessengerNotice(job.data);
			}
		},
	);
	return instance;
}

export async function startMessengerQueue() {
	if (boss) return boss;
	if (!starting) {
		starting = start().then((instance) => {
			boss = instance;
			return instance;
		});
	}
	return starting;
}

export async function stopMessengerQueue() {
	boss = null;
	starting = null;
	await stopBoss();
}

export async function enqueueMessengerNotice(notice: MessengerNotice) {
	const settings = await messengerSettings();
	if (!settings.enabled || !settings.accessToken) return;
	const [thread] = await db
		.select({ id: messengerThreads.id })
		.from(messengerThreads)
		.where(eq(messengerThreads.issueId, notice.issueId))
		.limit(1);
	if (!thread) return;
	const instance = await startMessengerQueue();
	await instance.send(MESSENGER_QUEUE, notice, {
		retryLimit: 5,
		retryDelay: 5,
		retryBackoff: true,
	});
}

/** Delivery is idempotent enough for chat: a retry posts the notice again only after a send error. */
export async function deliverMessengerNotice(notice: MessengerNotice) {
	const settings = await messengerSettings();
	if (!settings.enabled || !settings.accessToken) return "skipped";
	const [thread] = await db
		.select()
		.from(messengerThreads)
		.where(eq(messengerThreads.issueId, notice.issueId))
		.limit(1);
	if (!thread) return "skipped";
	const [issue] = await db
		.select({
			id: issues.id,
			key: issues.key,
			projectId: issues.projectId,
			statusName: statuses.name,
		})
		.from(issues)
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.where(eq(issues.id, notice.issueId))
		.limit(1);
	if (!issue) return "skipped";
	const desk = await deskByProjectId(issue.projectId);
	if (!desk) return "skipped";
	const link = portalRequestLink(desk.id, issue.key);

	let body: string;
	if (notice.kind === "status") {
		body = `${issue.key} is now ${notice.status}\n${link}`;
	} else {
		const text = truncate(htmlToText(notice.html), COMMENT_LIMIT);
		if (text === "") return "skipped";
		body = `Agent ${notice.actorName} commented: ${text}\n${link}`;
	}
	await matrixSendText(settings, thread.roomId, body, thread.rootEventId);
	return "sent";
}
