import type { NotificationKind } from "./schema-notifications.ts";

const actions: Record<NotificationKind, string> = {
	created: "created",
	updated: "updated",
	transitioned: "changed the status of",
	commented: "commented on",
	comment_edited: "edited a comment on",
	assigned: "assigned",
	worklog_added: "logged work on",
	attachment_added: "attached a file to",
	deleted: "deleted",
	mentioned: "mentioned you on",
};

export function notificationAction(kind: NotificationKind) {
	return actions[kind];
}

export function truncate(value: string | null | undefined, max = 300) {
	if (!value) return null;
	const text = value.trim();
	if (text === "") return null;
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
