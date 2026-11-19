import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./schema.ts";

export const notificationKinds = [
	"created",
	"updated",
	"transitioned",
	"commented",
	"comment_edited",
	"assigned",
	"worklog_added",
	"attachment_added",
	"deleted",
	"mentioned",
] as const;

export type NotificationKind = (typeof notificationKinds)[number];

export type EventChanges = {
	field: string;
	from: string | null;
	to: string | null;
};

export type EventPayload = {
	changes: EventChanges[];
	commentHtml: string | null;
	attachmentName: string | null;
	worklogSeconds: number | null;
	worklogComment: string | null;
};

export type BatchEvent = EventPayload & {
	kind: NotificationKind;
	actorId: string | null;
	actorName: string;
	createdAt: string;
};

export const emptyPayload: EventPayload = {
	changes: [],
	commentHtml: null,
	attachmentName: null,
	worklogSeconds: null,
	worklogComment: null,
};

export const userSettings = pgTable("user_settings", {
	userId: uuid("user_id")
		.primaryKey()
		.references(() => users.id, { onDelete: "cascade" }),
	emailNotifications: boolean("email_notifications").notNull().default(true),
	notifyOwnChanges: boolean("notify_own_changes").notNull().default(false),
	autoWatch: boolean("auto_watch").notNull().default(true),
	emailFormat: text("email_format", { enum: ["html", "text"] })
		.notNull()
		.default("html"),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

// The issue is a snapshot, not a reference: a "deleted" notification outlives the issue.
export const notifications = pgTable(
	"notifications",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		issueId: uuid("issue_id"),
		issueKey: text("issue_key").notNull(),
		issueSummary: text("issue_summary").notNull(),
		actorId: uuid("actor_id").references(() => users.id, {
			onDelete: "set null",
		}),
		kind: text("kind", { enum: notificationKinds }).notNull(),
		direct: boolean("direct").notNull().default(false),
		payload: jsonb("payload")
			.$type<EventPayload>()
			.notNull()
			.default(emptyPayload),
		readAt: timestamp("read_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("notifications_user_created_idx").on(table.userId, table.createdAt),
		index("notifications_user_read_idx").on(table.userId, table.readAt),
	],
);

// One row per recipient and issue; events inside the batching window append to it.
export const emailBatches = pgTable(
	"email_batches",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		issueId: uuid("issue_id").notNull(),
		issueKey: text("issue_key").notNull(),
		issueSummary: text("issue_summary").notNull(),
		events: jsonb("events").$type<BatchEvent[]>().notNull().default([]),
		reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
		sendAfter: timestamp("send_after", { withTimezone: true }).notNull(),
		sentAt: timestamp("sent_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("email_batches_open_idx").on(
			table.userId,
			table.issueId,
			table.createdAt,
		),
	],
);
