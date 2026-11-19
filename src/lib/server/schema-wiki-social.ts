import {
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./schema.ts";
import { pages, spaces } from "./schema-wiki.ts";

const createdAt = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
};

export const pageWatchers = pgTable(
	"page_watchers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => pages.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		sourceId: text("source_id"),
		...createdAt,
	},
	(table) => [
		unique("page_watchers_page_user_unique").on(table.pageId, table.userId),
		index("page_watchers_user_idx").on(table.userId),
	],
);

export const spaceWatchers = pgTable(
	"space_watchers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		spaceId: uuid("space_id")
			.notNull()
			.references(() => spaces.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		sourceId: text("source_id"),
		...createdAt,
	},
	(table) => [
		unique("space_watchers_space_user_unique").on(table.spaceId, table.userId),
		index("space_watchers_user_idx").on(table.userId),
	],
);

export const pageLikes = pgTable(
	"page_likes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => pages.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		sourceId: text("source_id"),
		...createdAt,
	},
	(table) => [
		unique("page_likes_page_user_unique").on(table.pageId, table.userId),
		index("page_likes_page_idx").on(table.pageId),
	],
);
