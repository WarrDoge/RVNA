import {
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { boards, sprints } from "./schema-agile.ts";

/**
 * Jira can put one sprint on several boards (a sprint has an origin board but
 * is shown on every board whose filter includes it). The sprint keeps its
 * origin board; this table records the other boards that show it.
 */
export const boardSprints = pgTable(
	"board_sprints",
	{
		boardId: uuid("board_id")
			.notNull()
			.references(() => boards.id, { onDelete: "cascade" }),
		sprintId: uuid("sprint_id")
			.notNull()
			.references(() => sprints.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.boardId, table.sprintId] }),
		index("board_sprints_sprint_idx").on(table.sprintId),
	],
);

/**
 * Jira's sprint report is the authority for a closed sprint's scope. The
 * Sprint field can keep sprints an issue was moved out of, so history alone
 * cannot always tell which issues were punted at sprint close.
 */
export const sprintReports = pgTable("sprint_reports", {
	id: uuid("id").primaryKey().defaultRandom(),
	sprintId: uuid("sprint_id")
		.notNull()
		.unique()
		.references(() => sprints.id, { onDelete: "cascade" }),
	rapidViewId: integer("rapid_view_id").notNull(),
	contents: jsonb("contents").$type<Record<string, unknown>>().notNull(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
