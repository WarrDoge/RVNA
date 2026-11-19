import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { userRefSchema } from "./api-schemas.ts";
import { type CurrentUser, effectiveGroups } from "./auth.ts";
import { userAvatarSql } from "./avatars.ts";
import { db } from "./db.ts";
import { extractMentionedUserIds } from "./html.ts";
import { HttpError } from "./http.ts";
import { queueEmailEvents } from "./mail.ts";
import { enqueueMessengerNotice } from "./messenger/notices.ts";
import { notificationAction } from "./notification-text.ts";
import { visibleProjectIds } from "./permissions.ts";
import {
	type BatchEvent,
	type EventChanges,
	issues,
	type NotificationKind,
	notificationKinds,
	notifications,
	userSettings,
	users,
	watchers,
} from "./schema.ts";
import { deskByProjectId, isAgent } from "./servicedesk/access.ts";

export type IssueEventInput = {
	issue: {
		id: string;
		key: string;
		summary: string;
		reporterId: string | null;
		assigneeId: string | null;
	};
	actor: { id: string; displayName: string };
	kind: NotificationKind;
	changes?: EventChanges[];
	commentHtml?: string | null;
	attachmentName?: string | null;
	worklogSeconds?: number | null;
	worklogComment?: string | null;
	mentionedUserIds?: string[];
	/** An internal comment reaches the desk's agents only. */
	internal?: boolean;
	now?: Date;
};

export type NotificationSettings = {
	emailNotifications: boolean;
	notifyOwnChanges: boolean;
	autoWatch: boolean;
	emailFormat: "html" | "text";
};

const defaults: NotificationSettings = {
	emailNotifications: true,
	notifyOwnChanges: false,
	autoWatch: true,
	emailFormat: "html",
};

function settingsFrom(row: {
	emailNotifications: boolean | null;
	notifyOwnChanges: boolean | null;
	autoWatch: boolean | null;
	emailFormat: "html" | "text" | null;
}): NotificationSettings {
	return {
		emailNotifications: row.emailNotifications ?? defaults.emailNotifications,
		notifyOwnChanges: row.notifyOwnChanges ?? defaults.notifyOwnChanges,
		autoWatch: row.autoWatch ?? defaults.autoWatch,
		emailFormat: row.emailFormat ?? defaults.emailFormat,
	};
}

export async function notificationSettings(
	userId: string,
): Promise<NotificationSettings> {
	const [row] = await db
		.select()
		.from(userSettings)
		.where(eq(userSettings.userId, userId))
		.limit(1);
	return row ? settingsFrom(row) : { ...defaults };
}

export async function saveNotificationSettings(
	userId: string,
	values: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
	const updates = Object.fromEntries(
		Object.entries(values).filter(([, value]) => value !== undefined),
	) as Partial<NotificationSettings>;
	const [row] = await db
		.insert(userSettings)
		.values({ userId, ...defaults, ...updates, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: userSettings.userId,
			set: { ...updates, updatedAt: new Date() },
		})
		.returning();
	return settingsFrom(row);
}

export function newMentions(
	previousHtml: string | null | undefined,
	nextHtml: string | null | undefined,
) {
	const previous = new Set(extractMentionedUserIds(previousHtml));
	return extractMentionedUserIds(nextHtml).filter((id) => !previous.has(id));
}

async function autoWatch(issueId: string, userId: string | null) {
	if (!userId) return;
	const settings = await notificationSettings(userId);
	if (!settings.autoWatch) return;
	await db
		.insert(watchers)
		.values({ sourceId: null, issueId, userId })
		.onConflictDoNothing();
}

type Recipient = {
	id: string;
	username: string;
	isAdmin: boolean;
	email: string | null;
	displayName: string;
	settings: NotificationSettings;
};

async function loadRecipients(ids: string[]): Promise<Recipient[]> {
	if (ids.length === 0) return [];
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			isAdmin: users.isAdmin,
			email: users.email,
			displayName: users.displayName,
			emailNotifications: userSettings.emailNotifications,
			notifyOwnChanges: userSettings.notifyOwnChanges,
			autoWatch: userSettings.autoWatch,
			emailFormat: userSettings.emailFormat,
		})
		.from(users)
		.leftJoin(userSettings, eq(userSettings.userId, users.id))
		.where(and(eq(users.active, true), inArray(users.id, ids)));

	return rows.map((row) => ({
		id: row.id,
		username: row.username,
		isAdmin: row.isAdmin,
		email: row.email,
		displayName: row.displayName,
		settings: settingsFrom(row),
	}));
}

async function watcherIds(issueId: string) {
	const rows = await db
		.select({ userId: watchers.userId })
		.from(watchers)
		.where(eq(watchers.issueId, issueId));
	return rows.map((row) => row.userId);
}

function reasonsFor(
	event: IssueEventInput,
	userId: string,
	mentioned: boolean,
	watching: boolean,
) {
	const reasons: string[] = [];
	if (mentioned) reasons.push("you were mentioned in it");
	if (userId === event.issue.assigneeId) reasons.push("it is assigned to you");
	if (userId === event.issue.reporterId) reasons.push("you reported it");
	if (watching) reasons.push("you are watching it");
	return reasons;
}

async function visibleRecipients(
	input: IssueEventInput,
	recipients: Recipient[],
): Promise<Recipient[]> {
	if (!input.internal) return recipients;
	const [issue] = await db
		.select({ projectId: issues.projectId })
		.from(issues)
		.where(eq(issues.id, input.issue.id))
		.limit(1);
	const desk = issue ? await deskByProjectId(issue.projectId) : null;
	if (!desk) return [];
	const kept: Recipient[] = [];
	for (const recipient of recipients) {
		const viewer = {
			id: recipient.id,
			username: recipient.username,
			isAdmin: recipient.isAdmin,
			groups: await effectiveGroups(recipient.id),
		};
		if (await isAgent(viewer, desk)) kept.push(recipient);
	}
	return kept;
}

async function recordIssueEventUnsafe(input: IssueEventInput) {
	const now = input.now ?? new Date();
	const mentioned = new Set(input.mentionedUserIds ?? []);

	if (input.kind === "created" || input.kind === "commented") {
		await autoWatch(input.issue.id, input.actor.id);
	}
	if (input.kind === "assigned") {
		await autoWatch(input.issue.id, input.issue.assigneeId);
	}

	const watching = new Set(await watcherIds(input.issue.id));
	const candidateIds = [
		...new Set(
			[
				input.issue.reporterId,
				input.issue.assigneeId,
				...watching,
				...mentioned,
			].filter((id): id is string => Boolean(id)),
		),
	];
	const recipients = await visibleRecipients(
		input,
		await loadRecipients(candidateIds),
	);

	const changes = input.changes ?? [];
	const payload = {
		changes,
		commentHtml: input.commentHtml ?? null,
		attachmentName: input.attachmentName ?? null,
		worklogSeconds: input.worklogSeconds ?? null,
		worklogComment: input.worklogComment ?? null,
	};

	const rows: (typeof notifications.$inferInsert)[] = [];
	const emails: { recipient: Recipient; kind: NotificationKind }[] = [];

	for (const recipient of recipients) {
		if (
			recipient.id === input.actor.id &&
			!recipient.settings.notifyOwnChanges
		) {
			continue;
		}
		const isMentioned = mentioned.has(recipient.id);
		const kind: NotificationKind = isMentioned ? "mentioned" : input.kind;
		const direct =
			isMentioned ||
			recipient.id === input.issue.reporterId ||
			recipient.id === input.issue.assigneeId;

		rows.push({
			userId: recipient.id,
			issueId: input.issue.id,
			issueKey: input.issue.key,
			issueSummary: input.issue.summary,
			actorId: input.actor.id,
			kind,
			direct,
			payload,
			createdAt: now,
		});
		emails.push({ recipient, kind });
	}

	if (rows.length > 0) {
		await db.insert(notifications).values(rows);
	}

	try {
		for (const { recipient, kind } of emails) {
			if (!recipient.settings.emailNotifications) continue;
			const batchEvent: BatchEvent = {
				kind,
				actorId: input.actor.id,
				actorName: input.actor.displayName,
				changes,
				commentHtml: input.commentHtml ?? null,
				attachmentName: input.attachmentName ?? null,
				worklogSeconds: input.worklogSeconds ?? null,
				worklogComment: input.worklogComment ?? null,
				createdAt: now.toISOString(),
			};
			await queueEmailEvents(
				recipient,
				input.issue,
				[batchEvent],
				reasonsFor(
					input,
					recipient.id,
					kind === "mentioned",
					watching.has(recipient.id),
				),
				now,
			);
		}
	} catch (error) {
		console.error("notification email: could not queue a notification", error);
	}
}

export async function recordIssueEvent(input: IssueEventInput) {
	try {
		await recordIssueEventUnsafe(input);
	} catch (error) {
		console.error("notification: could not record an issue event", error);
	}

	try {
		if (input.kind === "transitioned") {
			const status = input.changes?.find((change) => change.field === "Status");
			if (status?.to) {
				await enqueueMessengerNotice({
					kind: "status",
					issueId: input.issue.id,
					status: status.to,
				});
			}
		}
		if (input.kind === "commented" && !input.internal) {
			await enqueueMessengerNotice({
				kind: "comment",
				issueId: input.issue.id,
				actorName: input.actor.displayName,
				html: input.commentHtml ?? "",
			});
		}
	} catch (error) {
		console.error("messenger: could not queue a notice", error);
	}
}

export const notificationSchema = z.object({
	id: z.uuid(),
	actor: userRefSchema.nullable(),
	kind: z.enum(notificationKinds),
	action: z.string(),
	issue: z.object({
		id: z.uuid().nullable(),
		key: z.string(),
		summary: z.string(),
	}),
	direct: z.boolean(),
	read: z.boolean(),
	created: z.iso.datetime(),
});

export const notificationListSchema = z.object({
	notifications: z.array(notificationSchema),
	total: z.number().int(),
	unread: z.number().int(),
	offset: z.number().int(),
	limit: z.number().int(),
});

export const notificationSettingsSchema = z.object({
	emailNotifications: z.boolean(),
	notifyOwnChanges: z.boolean(),
	autoWatch: z.boolean(),
	emailFormat: z.enum(["html", "text"]),
});

export const unreadSchema = z.object({ unread: z.number().int() });

function visibleNotification(userId: string, visible: string[]) {
	const projectFilter =
		visible.length === 0
			? sql`false`
			: sql`exists (
				select 1 from issues i
				where i.id = notifications.issue_id
					and i.project_id = any(${sql.param(visible)}::uuid[])
			)`;
	return and(eq(notifications.userId, userId), projectFilter);
}

async function unreadCount(userId: string, visible: string[]) {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(notifications)
		.where(
			and(visibleNotification(userId, visible), isNull(notifications.readAt)),
		);
	return row?.count ?? 0;
}

export async function listNotifications(
	user: CurrentUser,
	query: { offset: number; limit: number; tab: "all" | "direct" | "watching" },
) {
	const visible = await visibleProjectIds(user);
	const tabFilter =
		query.tab === "direct"
			? eq(notifications.direct, true)
			: query.tab === "watching"
				? eq(notifications.direct, false)
				: undefined;
	const filter = tabFilter
		? and(visibleNotification(user.id, visible), tabFilter)
		: visibleNotification(user.id, visible);

	const actor = alias(users, "notification_actor");
	const [rows, total, unread] = await Promise.all([
		db
			.select({
				id: notifications.id,
				kind: notifications.kind,
				issueId: notifications.issueId,
				issueKey: notifications.issueKey,
				issueSummary: notifications.issueSummary,
				direct: notifications.direct,
				readAt: notifications.readAt,
				createdAt: notifications.createdAt,
				actorId: actor.id,
				actorUsername: actor.username,
				actorDisplayName: actor.displayName,
				actorAvatarUrl: userAvatarSql(actor.id),
			})
			.from(notifications)
			.leftJoin(actor, eq(actor.id, notifications.actorId))
			.where(filter)
			.orderBy(desc(notifications.createdAt), desc(notifications.id))
			.offset(query.offset)
			.limit(query.limit),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(notifications)
			.where(filter),
		unreadCount(user.id, visible),
	]);

	return {
		notifications: rows.map((row) => ({
			id: row.id,
			actor:
				row.actorId && row.actorUsername && row.actorDisplayName
					? {
							id: row.actorId,
							username: row.actorUsername,
							displayName: row.actorDisplayName,
							avatarUrl: row.actorAvatarUrl,
						}
					: null,
			kind: row.kind,
			action: notificationAction(row.kind),
			issue: {
				id: row.issueId,
				key: row.issueKey,
				summary: row.issueSummary,
			},
			direct: row.direct,
			read: row.readAt !== null,
			created: row.createdAt.toISOString(),
		})),
		total: total[0]?.count ?? 0,
		unread,
		offset: query.offset,
		limit: query.limit,
	};
}

export async function unreadNotifications(user: CurrentUser) {
	return {
		unread: await unreadCount(user.id, await visibleProjectIds(user)),
	};
}

export async function markAllNotificationsRead(user: CurrentUser) {
	await db
		.update(notifications)
		.set({ readAt: new Date() })
		.where(
			and(eq(notifications.userId, user.id), isNull(notifications.readAt)),
		);
	return { unread: 0 };
}

export async function markNotificationRead(user: CurrentUser, id: string) {
	const visible = await visibleProjectIds(user);
	const [updated] = await db
		.update(notifications)
		.set({ readAt: new Date() })
		.where(and(eq(notifications.id, id), visibleNotification(user.id, visible)))
		.returning({ id: notifications.id });

	if (!updated) throw new HttpError(404, "Notification not found");
	return { unread: await unreadCount(user.id, visible) };
}

export async function getNotificationSettings(user: CurrentUser) {
	return notificationSettings(user.id);
}

export async function updateNotificationSettings(
	user: CurrentUser,
	values: Partial<NotificationSettings>,
) {
	return saveNotificationSettings(user.id, values);
}
