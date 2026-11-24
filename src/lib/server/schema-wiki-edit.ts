import { sql } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./schema.ts";
import { pages, spaces } from "./schema-wiki.ts";

/**
 * One live edit lock per page. `acquiredAt` is when the current holder took the
 * lock; `takenOverFrom`/`takenOverAt` name the previous holder when a live lock
 * was taken over and are null for a normal claim or re-claim.
 */
export const pageLocks = pgTable("page_locks", {
	pageId: uuid("page_id")
		.primaryKey()
		.references(() => pages.id, { onDelete: "cascade" }),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	acquiredAt: timestamp("acquired_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	heartbeatAt: timestamp("heartbeat_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	takenOverFrom: uuid("taken_over_from").references(() => users.id, {
		onDelete: "set null",
	}),
	takenOverAt: timestamp("taken_over_at", { withTimezone: true }),
});

export const pageDrafts = pgTable(
	"page_drafts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		pageId: uuid("page_id").references(() => pages.id, { onDelete: "cascade" }),
		spaceId: uuid("space_id")
			.notNull()
			.references(() => spaces.id, { onDelete: "cascade" }),
		parentId: uuid("parent_id").references(() => pages.id, {
			onDelete: "set null",
		}),
		title: text("title").notNull().default(""),
		bodyDoc: jsonb("body_doc").$type<Record<string, unknown>>(),
		labels: jsonb("labels").$type<string[]>().notNull().default([]),
		baseVersion: integer("base_version"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("page_drafts_user_page_unique")
			.on(table.userId, table.pageId)
			.where(sql`page_id is not null`),
		index("page_drafts_user_idx").on(table.userId),
	],
);

export const pageTrash = pgTable("page_trash", {
	pageId: uuid("page_id")
		.primaryKey()
		.references(() => pages.id, { onDelete: "cascade" }),
	trashedBy: uuid("trashed_by").references(() => users.id, {
		onDelete: "set null",
	}),
	trashedAt: timestamp("trashed_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	originalParentId: uuid("original_parent_id").references(() => pages.id, {
		onDelete: "set null",
	}),
	originalPosition: integer("original_position").notNull().default(0),
	/** The pages that trashing moved up to `originalParentId`; restoring moves them back. */
	movedChildren: uuid("moved_children").array().notNull().default([]),
});
