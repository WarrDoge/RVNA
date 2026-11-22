import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./schema.ts";

/** Jira's built-in System Dashboard; the REST list marks no default, so the id identifies it. */
export const SYSTEM_DASHBOARD_ID = "10000";

const importedAt = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
};

export const dashboards = pgTable(
	"dashboards",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		name: text("name").notNull(),
		description: text("description"),
		ownerId: uuid("owner_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		layout: text("layout", { enum: ["A", "AA", "AB", "BA", "AAA"] })
			.notNull()
			.default("AA"),
		shared: boolean("shared").notNull().default(false),
		...importedAt,
	},
	(table) => [index("dashboards_owner_idx").on(table.ownerId)],
);

export const dashboardFavourites = pgTable(
	"dashboard_favourites",
	{
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		dashboardId: uuid("dashboard_id")
			.notNull()
			.references(() => dashboards.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.dashboardId] })],
);

export const dashboardGadgets = pgTable(
	"dashboard_gadgets",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		dashboardId: uuid("dashboard_id")
			.notNull()
			.references(() => dashboards.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		title: text("title"),
		columnIndex: integer("column_index").notNull().default(0),
		rowIndex: integer("row_index").notNull().default(0),
		color: text("color").notNull().default("color1"),
		refreshSeconds: integer("refresh_seconds").notNull().default(0),
		config: jsonb("config").notNull().default({}),
		...importedAt,
	},
	(table) => [index("dashboard_gadgets_dashboard_idx").on(table.dashboardId)],
);
