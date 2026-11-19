import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { issues, projects, statuses, users } from "./schema.ts";

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
};

export const boards = pgTable(
	"boards",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// The Jira rapidView id, kept as the public id so old bookmarks work.
		rapidViewId: integer("rapid_view_id").notNull().unique(),
		// The Jira board id used by the real board import to overwrite this row.
		sourceId: text("source_id").unique(),
		name: text("name").notNull(),
		type: text("type", { enum: ["scrum", "kanban"] }).notNull(),
		filterJql: text("filter_jql").notNull(),
		projectId: uuid("project_id").references(() => projects.id, {
			onDelete: "set null",
		}),
		estimationField: text("estimation_field", {
			enum: ["story_points", "original_estimate", "issue_count"],
		})
			.notNull()
			.default("story_points"),
		swimlaneStrategy: text("swimlane_strategy", {
			enum: ["none", "assignee", "epic", "queries"],
		})
			.notNull()
			.default("none"),
		cardColourStrategy: text("card_colour_strategy", {
			enum: ["none", "priority", "assignee", "epic", "issue_type"],
		})
			.notNull()
			.default("none"),
		subFilterJql: text("sub_filter_jql"),
		// Issues in this status sit in the kanban backlog instead of the board.
		kanbanBacklogStatusId: uuid("kanban_backlog_status_id").references(
			() => statuses.id,
			{ onDelete: "set null" },
		),
		ownerId: uuid("owner_id").references(() => users.id, {
			onDelete: "set null",
		}),
		// False for boards the local sprint import derived from issue data; the
		// real board import replaces those.
		configImported: boolean("config_imported").notNull().default(true),
		...timestamps,
	},
	(table) => [index("boards_project_idx").on(table.projectId)],
);

export const boardColumns = pgTable(
	"board_columns",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		boardId: uuid("board_id")
			.notNull()
			.references(() => boards.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		sequence: integer("sequence").notNull().default(0),
		minIssues: integer("min_issues"),
		maxIssues: integer("max_issues"),
		...timestamps,
	},
	(table) => [
		index("board_columns_board_idx").on(table.boardId, table.sequence),
	],
);

export const boardColumnStatuses = pgTable(
	"board_column_statuses",
	{
		columnId: uuid("column_id")
			.notNull()
			.references(() => boardColumns.id, { onDelete: "cascade" }),
		statusId: uuid("status_id")
			.notNull()
			.references(() => statuses.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull().default(0),
	},
	(table) => [
		primaryKey({ columns: [table.columnId, table.statusId] }),
		index("board_column_statuses_status_idx").on(table.statusId),
	],
);

export const boardSwimlanes = pgTable(
	"board_swimlanes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		boardId: uuid("board_id")
			.notNull()
			.references(() => boards.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		jql: text("jql").notNull(),
		sequence: integer("sequence").notNull().default(0),
		...timestamps,
	},
	(table) => [
		index("board_swimlanes_board_idx").on(table.boardId, table.sequence),
	],
);

export const boardQuickFilters = pgTable(
	"board_quick_filters",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		boardId: uuid("board_id")
			.notNull()
			.references(() => boards.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		jql: text("jql").notNull(),
		sequence: integer("sequence").notNull().default(0),
		...timestamps,
	},
	(table) => [
		index("board_quick_filters_board_idx").on(table.boardId, table.sequence),
	],
);

export const sprints = pgTable(
	"sprints",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// The Jira sprint id; the real board import upserts by it.
		sourceId: text("source_id").unique(),
		boardId: uuid("board_id")
			.notNull()
			.references(() => boards.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		goal: text("goal"),
		state: text("state", { enum: ["future", "active", "closed"] })
			.notNull()
			.default("future"),
		startDate: timestamp("start_date", { withTimezone: true }),
		endDate: timestamp("end_date", { withTimezone: true }),
		completeDate: timestamp("complete_date", { withTimezone: true }),
		sequence: integer("sequence").notNull().default(0),
		...timestamps,
	},
	(table) => [index("sprints_board_idx").on(table.boardId, table.sequence)],
);

export const issueSprints = pgTable(
	"issue_sprints",
	{
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		sprintId: uuid("sprint_id")
			.notNull()
			.references(() => sprints.id, { onDelete: "cascade" }),
		// True for the issue's single active or future sprint. Closed sprints
		// keep their rows with this flag cleared.
		isOpen: boolean("is_open").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.issueId, table.sprintId] }),
		index("issue_sprints_sprint_idx").on(table.sprintId),
		uniqueIndex("issue_sprints_one_open_unique")
			.on(table.issueId)
			.where(sql`${table.isOpen}`),
	],
);
