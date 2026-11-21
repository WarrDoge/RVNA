import { and, eq, gt, sql } from "drizzle-orm";
import type { CurrentUser } from "../auth.ts";
import { effectiveGroups } from "../auth.ts";
import { db } from "../db.ts";
import { sanitizeBodyHtml } from "../html.ts";
import {
	issues,
	messengerProcessedEvents,
	messengerThreads,
	requestTypes,
	statuses,
	users,
} from "../schema.ts";
import {
	canRaiseRequests,
	canViewRequest,
	deskByPortalId,
	deskByProjectId,
} from "../servicedesk/access.ts";
import { addCustomerComment, createRequest } from "../servicedesk/portal.ts";
import { type MatrixEvent, matrixReact, matrixSendText } from "./client.ts";
import type { MessengerSettings } from "./config.ts";
import { matrixIdParts, recordMessengerError } from "./config.ts";
import { redeemMessengerLinkCode, shouldSendUnknownNotice } from "./links.ts";
import {
	DESCRIPTION_LIMIT,
	helpText,
	plainTextToHtml,
	portalCreateLink,
	portalRequestLink,
	RATE_LIMIT,
	RATE_WINDOW_MS,
	SUMMARY_LIMIT,
	truncate,
	unknownSenderText,
	usageText,
} from "./text.ts";

const CHECK_MARK = "\u2705";

async function userForMatrixId(
	settings: MessengerSettings,
	matrixId: string,
): Promise<CurrentUser | null> {
	const [linked] = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			email: users.email,
			active: users.active,
			isAdmin: users.isAdmin,
			mustChangePassword: users.mustChangePassword,
			passwordHash: users.passwordHash,
		})
		.from(users)
		.where(eq(users.messengerMatrixId, matrixId))
		.limit(1);
	if (linked) {
		if (!linked.active) return null;
		return {
			id: linked.id,
			username: linked.username,
			displayName: linked.displayName,
			email: linked.email,
			avatarUrl: null,
			groups: await effectiveGroups(linked.id),
			isAdmin: linked.isAdmin,
			mustChangePassword: linked.mustChangePassword,
			hasPassword: linked.passwordHash !== null,
		};
	}

	const parts = matrixIdParts(matrixId);
	if (!parts || !settings.serverName) return null;
	if (parts.serverName.toLowerCase() !== settings.serverName.toLowerCase()) {
		return null;
	}
	const [byName] = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			email: users.email,
			isAdmin: users.isAdmin,
			mustChangePassword: users.mustChangePassword,
			passwordHash: users.passwordHash,
		})
		.from(users)
		.where(
			and(
				sql`lower(${users.username}) = ${parts.localpart.toLowerCase()}`,
				eq(users.active, true),
			),
		)
		.limit(1);
	if (!byName) return null;
	return {
		id: byName.id,
		username: byName.username,
		displayName: byName.displayName,
		email: byName.email,
		avatarUrl: null,
		groups: await effectiveGroups(byName.id),
		isAdmin: byName.isAdmin,
		mustChangePassword: byName.mustChangePassword,
		hasPassword: byName.passwordHash !== null,
	};
}

async function markProcessed(roomId: string, eventId: string) {
	const [row] = await db
		.insert(messengerProcessedEvents)
		.values({ roomId, eventId })
		.onConflictDoNothing()
		.returning({ eventId: messengerProcessedEvents.eventId });
	return Boolean(row);
}

async function reply(
	settings: MessengerSettings,
	roomId: string,
	rootEventId: string,
	body: string,
) {
	await matrixSendText(settings, roomId, body, rootEventId);
}

async function replyUnknown(
	settings: MessengerSettings,
	roomId: string,
	rootEventId: string,
	matrixId: string,
) {
	if (await shouldSendUnknownNotice(matrixId)) {
		await reply(settings, roomId, rootEventId, unknownSenderText());
	}
}

async function loadThread(roomId: string, event: MatrixEvent) {
	const relation = event.content?.["m.relates_to"] as
		| { rel_type?: unknown; event_id?: unknown }
		| undefined;
	if (
		relation?.rel_type !== "m.thread" ||
		typeof relation.event_id !== "string"
	) {
		return null;
	}
	const [thread] = await db
		.select()
		.from(messengerThreads)
		.where(
			and(
				eq(messengerThreads.roomId, roomId),
				eq(messengerThreads.rootEventId, relation.event_id),
			),
		)
		.limit(1);
	return thread ?? null;
}

async function loadRequest(issueId: string) {
	const [issue] = await db
		.select({
			id: issues.id,
			key: issues.key,
			summary: issues.summary,
			projectId: issues.projectId,
			requestTypeId: issues.requestTypeId,
			reporterId: issues.reporterId,
			creatorId: issues.creatorId,
			statusName: statuses.name,
			assigneeName: users.displayName,
		})
		.from(issues)
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.leftJoin(users, eq(users.id, issues.assigneeId))
		.where(eq(issues.id, issueId))
		.limit(1);
	return issue ?? null;
}

async function loadRequestByKey(key: string) {
	const [issue] = await db
		.select({
			id: issues.id,
			key: issues.key,
			summary: issues.summary,
			projectId: issues.projectId,
			requestTypeId: issues.requestTypeId,
			reporterId: issues.reporterId,
			creatorId: issues.creatorId,
			statusName: statuses.name,
			assigneeName: users.displayName,
		})
		.from(issues)
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.leftJoin(users, eq(users.id, issues.assigneeId))
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	return issue ?? null;
}

async function deskForIssue(projectId: string) {
	return deskByProjectId(projectId);
}

async function handleThreadReply(
	settings: MessengerSettings,
	roomId: string,
	event: MatrixEvent,
	thread: typeof messengerThreads.$inferSelect,
	user: CurrentUser | null,
	body: string,
) {
	if (!user) {
		await replyUnknown(
			settings,
			roomId,
			thread.rootEventId,
			event.sender as string,
		);
		return;
	}
	const issue = await loadRequest(thread.issueId);
	if (!issue) return;
	const desk = await deskForIssue(issue.projectId);
	if (!desk) return;
	if (!(await canViewRequest(user, desk, issue))) {
		await reply(settings, roomId, thread.rootEventId, "Request not found.");
		return;
	}
	const text = body.trim();
	if (text === "") return;
	const html = await sanitizeBodyHtml(plainTextToHtml(text));
	if (!html) return;
	const result = await addCustomerComment(desk, issue.key, user, html);
	if (result.ok) {
		await matrixReact(settings, roomId, event.event_id as string, CHECK_MARK);
	}
}

async function handleAttachment(
	settings: MessengerSettings,
	roomId: string,
	thread: typeof messengerThreads.$inferSelect,
	user: CurrentUser | null,
) {
	if (thread.attachmentNotified || !user) return;
	const issue = await loadRequest(thread.issueId);
	if (!issue) return;
	const desk = await deskForIssue(issue.projectId);
	if (!desk || !(await canViewRequest(user, desk, issue))) return;
	await matrixSendText(
		settings,
		roomId,
		`Attach files in the portal: ${portalRequestLink(desk.id, issue.key)}`,
		thread.rootEventId,
	);
	await db
		.update(messengerThreads)
		.set({ attachmentNotified: true })
		.where(eq(messengerThreads.id, thread.id));
}

async function createTicket(
	settings: MessengerSettings,
	roomId: string,
	event: MatrixEvent,
	user: CurrentUser,
	summaryLine: string,
	descriptionText: string,
) {
	const summary = truncate(summaryLine.trim(), SUMMARY_LIMIT);
	if (summary === "") {
		await reply(settings, roomId, event.event_id as string, usageText());
		return;
	}
	const desk = settings.serviceDeskId
		? await deskByPortalId(settings.serviceDeskId)
		: null;
	if (!desk || !settings.requestTypeId) {
		await reply(
			settings,
			roomId,
			event.event_id as string,
			"Messenger is not configured to open requests.",
		);
		return;
	}
	const [requestType] = await db
		.select({ id: requestTypes.id, deskId: requestTypes.deskId })
		.from(requestTypes)
		.where(
			and(
				eq(requestTypes.id, settings.requestTypeId),
				eq(requestTypes.deskId, desk.id),
			),
		)
		.limit(1);
	if (!requestType) {
		await reply(
			settings,
			roomId,
			event.event_id as string,
			"Messenger is not configured to open requests.",
		);
		return;
	}
	if (!(await canRaiseRequests(user, desk))) {
		await reply(
			settings,
			roomId,
			event.event_id as string,
			"You do not have permission to open requests in this service desk.",
		);
		return;
	}

	const cutoff = new Date(Date.now() - RATE_WINDOW_MS);
	const [recent] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(
			and(
				eq(issues.reporterId, user.id),
				eq(issues.requestChannel, "chat"),
				gt(issues.created, cutoff),
			),
		);
	if ((recent?.count ?? 0) >= RATE_LIMIT) {
		await reply(
			settings,
			roomId,
			event.event_id as string,
			`You can open at most ${RATE_LIMIT} requests every 10 minutes. Try again later.`,
		);
		return;
	}

	const description =
		descriptionText.trim() === ""
			? null
			: await sanitizeBodyHtml(
					plainTextToHtml(truncate(descriptionText.trim(), DESCRIPTION_LIMIT)),
				);
	const result = await createRequest(desk, requestType.id, user, {
		summary,
		description,
		fields: {},
		channel: "chat",
	});
	if (!result.ok) {
		await reply(
			settings,
			roomId,
			event.event_id as string,
			`${result.error}. Open the request in the portal: ${portalCreateLink(desk.id, requestType.id)}`,
		);
		return;
	}

	await db
		.insert(messengerThreads)
		.values({
			issueId: result.id,
			roomId,
			rootEventId: event.event_id as string,
		})
		.onConflictDoNothing();
	await reply(
		settings,
		roomId,
		event.event_id as string,
		`Created ${result.key}: ${summary}\n${portalRequestLink(desk.id, result.key)}`,
	);
}

async function statusReply(
	settings: MessengerSettings,
	roomId: string,
	event: MatrixEvent,
	user: CurrentUser,
	key: string,
) {
	if (key.trim() === "") {
		await reply(
			settings,
			roomId,
			event.event_id as string,
			"Usage: !status KEY-123",
		);
		return;
	}
	const issue = await loadRequestByKey(key.trim());
	const desk = issue ? await deskForIssue(issue.projectId) : null;
	if (!issue || !desk || !(await canViewRequest(user, desk, issue))) {
		await reply(
			settings,
			roomId,
			event.event_id as string,
			"Request not found.",
		);
		return;
	}
	const assignee = issue.assigneeName
		? `assigned to ${issue.assigneeName}`
		: "unassigned";
	await reply(
		settings,
		roomId,
		event.event_id as string,
		`${issue.key}: ${issue.statusName} — ${assignee}\n${portalRequestLink(desk.id, issue.key)}`,
	);
}

async function handleCommand(
	settings: MessengerSettings,
	roomId: string,
	event: MatrixEvent,
	user: CurrentUser | null,
	command: string,
	argument: string,
) {
	const root = event.event_id as string;
	if (command === "help") {
		await reply(settings, roomId, root, helpText());
		return;
	}
	if (command === "link") {
		const result = await redeemMessengerLinkCode(
			event.sender as string,
			argument,
		);
		await reply(settings, roomId, root, result.message);
		return;
	}
	if (command !== "ticket" && command !== "status") {
		await reply(settings, roomId, root, helpText());
		return;
	}
	if (!user) {
		await replyUnknown(settings, roomId, root, event.sender as string);
		return;
	}
	if (command === "ticket") {
		const newline = argument.indexOf("\n");
		const summaryLine = newline === -1 ? argument : argument.slice(0, newline);
		const description = newline === -1 ? "" : argument.slice(newline + 1);
		await createTicket(settings, roomId, event, user, summaryLine, description);
		return;
	}
	if (command === "status") {
		await statusReply(settings, roomId, event, user, argument);
		return;
	}
	await reply(settings, roomId, root, helpText());
}

const RESEND = "Send it again.";

function errorReason(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.split("\n", 1)[0].slice(0, 300);
}

/**
 * Handles one timeline event after the sync layer has skipped encrypted rooms.
 * The event is marked processed first, so a failure is never retried: the
 * sender is told in the thread to send it again, and the error is recorded.
 * Returns false when the message failed.
 */
export async function handleMatrixMessage(
	settings: MessengerSettings,
	roomId: string,
	event: MatrixEvent,
): Promise<boolean> {
	if (event.type !== "m.room.message") return true;
	if (!event.event_id || !event.sender) return true;
	if (event.sender === settings.botMatrixId) return true;
	const content = event.content ?? {};
	if (content.msgtype === "m.notice") return true;
	if (!(await markProcessed(roomId, event.event_id))) return true;

	let threadRoot = event.event_id;
	let failure = `I could not process that message. ${RESEND}`;
	try {
		const thread = await loadThread(roomId, event);
		if (thread) threadRoot = thread.rootEventId;
		const body = typeof content.body === "string" ? content.body : "";
		const user = await userForMatrixId(settings, event.sender);

		if (content.msgtype !== "m.text") {
			if (thread) await handleAttachment(settings, roomId, thread, user);
			return true;
		}
		if (body.trimStart().startsWith("!")) {
			const text = body.trimStart();
			const newline = text.indexOf("\n");
			const firstLine = newline === -1 ? text : text.slice(0, newline);
			const rest = newline === -1 ? "" : text.slice(newline + 1);
			const space = firstLine.search(/\s/);
			const command = (space === -1 ? firstLine : firstLine.slice(0, space))
				.slice(1)
				.toLowerCase();
			const inline = space === -1 ? "" : firstLine.slice(space + 1).trimStart();
			const argument = rest === "" ? inline : `${inline}\n${rest}`;
			if (command === "ticket") {
				failure = `Your request could not be created. ${RESEND}`;
			}
			await handleCommand(settings, roomId, event, user, command, argument);
			return true;
		}
		if (thread) {
			failure = `Your comment could not be added. ${RESEND}`;
			await handleThreadReply(settings, roomId, event, thread, user, body);
		}
		return true;
	} catch (error) {
		const reason = errorReason(error);
		console.error("messenger: could not process a chat message:", reason);
		await recordMessengerError(
			`${new Date().toISOString()} Could not process a chat message: ${reason}`,
		).catch(() => undefined);
		await reply(settings, roomId, threadRoot, failure).catch(() => undefined);
		return false;
	}
}
