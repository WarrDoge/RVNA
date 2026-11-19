import {
	boolean,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { issues, users } from "./schema.ts";

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
};

export const messengerConfig = pgTable("messenger_config", {
	id: integer("id").primaryKey().default(1),
	homeserverUrl: text("homeserver_url").notNull().default(""),
	accessToken: text("access_token"),
	serviceDeskId: uuid("service_desk_id"),
	requestTypeId: uuid("request_type_id"),
	enabled: boolean("enabled").notNull().default(false),
	sinceToken: text("since_token"),
	botMatrixId: text("bot_matrix_id"),
	serverName: text("server_name"),
	lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
	lastError: text("last_error"),
	...timestamps,
});

export const messengerThreads = pgTable(
	"messenger_threads",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		issueId: uuid("issue_id")
			.notNull()
			.unique()
			.references(() => issues.id, { onDelete: "cascade" }),
		roomId: text("room_id").notNull(),
		rootEventId: text("root_event_id").notNull(),
		attachmentNotified: boolean("attachment_notified").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		unique("messenger_threads_room_root_unique").on(
			table.roomId,
			table.rootEventId,
		),
	],
);

export const messengerLinkCodes = pgTable(
	"messenger_link_codes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		code: text("code").notNull().unique(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		usedAt: timestamp("used_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("messenger_link_codes_user_idx").on(table.userId)],
);

export const messengerProcessedEvents = pgTable(
	"messenger_processed_events",
	{
		roomId: text("room_id").notNull(),
		eventId: text("event_id").notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.roomId, table.eventId] })],
);

export const messengerRooms = pgTable("messenger_rooms", {
	roomId: text("room_id").primaryKey(),
	encrypted: boolean("encrypted").notNull().default(false),
	encryptionNoticeSent: boolean("encryption_notice_sent")
		.notNull()
		.default(false),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const messengerUnknownSenders = pgTable("messenger_unknown_senders", {
	matrixId: text("matrix_id").primaryKey(),
	lastNoticeAt: timestamp("last_notice_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
