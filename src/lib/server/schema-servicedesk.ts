import {
	type AnyPgColumn,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { SlaCondition, WorkingInterval } from "../shared/sla/types.ts";
import { issues, issueTypes, projects } from "./schema.ts";

const importedAt = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
};

export const serviceDesks = pgTable(
	"service_desks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		portalName: text("portal_name").notNull(),
		description: text("description"),
		announcement: text("announcement"),
		openAccess: boolean("open_access").notNull().default(true),
		...importedAt,
	},
	(table) => [index("service_desks_project_idx").on(table.projectId)],
);

export const requestTypeGroups = pgTable(
	"request_type_groups",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull(),
		deskId: uuid("desk_id")
			.notNull()
			.references(() => serviceDesks.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		sequence: integer("sequence").notNull().default(0),
		...importedAt,
	},
	(table) => [
		unique("request_type_groups_desk_source_unique").on(
			table.deskId,
			table.sourceId,
		),
		index("request_type_groups_desk_idx").on(table.deskId),
	],
);

export const requestTypes = pgTable(
	"request_types",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull(),
		deskId: uuid("desk_id")
			.notNull()
			.references(() => serviceDesks.id, { onDelete: "cascade" }),
		issueTypeId: uuid("issue_type_id").references(() => issueTypes.id, {
			onDelete: "set null",
		}),
		name: text("name").notNull(),
		description: text("description"),
		helpText: text("help_text"),
		iconName: text("icon_name"),
		sequence: integer("sequence").notNull().default(0),
		...importedAt,
	},
	(table) => [
		unique("request_types_desk_source_unique").on(table.deskId, table.sourceId),
		index("request_types_desk_idx").on(table.deskId),
	],
);

export const requestTypeGroupMembers = pgTable(
	"request_type_group_members",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		requestTypeId: uuid("request_type_id")
			.notNull()
			.references(() => requestTypes.id, { onDelete: "cascade" }),
		groupId: uuid("group_id")
			.notNull()
			.references(() => requestTypeGroups.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull().default(0),
		...importedAt,
	},
	(table) => [
		unique("request_type_group_members_type_group_unique").on(
			table.requestTypeId,
			table.groupId,
		),
	],
);

export const requestTypeFields = pgTable(
	"request_type_fields",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		requestTypeId: uuid("request_type_id")
			.notNull()
			.references(() => requestTypes.id, { onDelete: "cascade" }),
		fieldId: text("field_id").notNull(),
		label: text("label").notNull(),
		description: text("description"),
		required: boolean("required").notNull().default(false),
		sequence: integer("sequence").notNull().default(0),
		hiddenValue: jsonb("hidden_value"),
		...importedAt,
	},
	(table) => [
		unique("request_type_fields_type_field_unique").on(
			table.requestTypeId,
			table.fieldId,
		),
	],
);

export const queues = pgTable(
	"queues",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull(),
		deskId: uuid("desk_id")
			.notNull()
			.references(() => serviceDesks.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		jql: text("jql").notNull(),
		columns: jsonb("columns").$type<string[]>().notNull(),
		issueCount: integer("issue_count"),
		sequence: integer("sequence").notNull().default(0),
		parentId: uuid("parent_id").references((): AnyPgColumn => queues.id, {
			onDelete: "set null",
		}),
		...importedAt,
	},
	(table) => [
		unique("queues_desk_source_unique").on(table.deskId, table.sourceId),
		index("queues_desk_idx").on(table.deskId),
	],
);

export const slaCalendars = pgTable("sla_calendars", {
	id: uuid("id").primaryKey().defaultRandom(),
	sourceId: text("source_id").notNull().unique(),
	name: text("name").notNull(),
	timezone: text("timezone").notNull(),
	workingHours: jsonb("working_hours").$type<WorkingInterval[][]>().notNull(),
	holidays: jsonb("holidays").$type<string[]>().notNull(),
	...importedAt,
});

export const slaMetrics = pgTable(
	"sla_metrics",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull(),
		deskId: uuid("desk_id")
			.notNull()
			.references(() => serviceDesks.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		customerVisible: boolean("customer_visible").notNull().default(false),
		startConditions: jsonb("start_conditions")
			.$type<SlaCondition[]>()
			.notNull(),
		pauseConditions: jsonb("pause_conditions")
			.$type<SlaCondition[]>()
			.notNull(),
		stopConditions: jsonb("stop_conditions").$type<SlaCondition[]>().notNull(),
		...importedAt,
	},
	(table) => [
		unique("sla_metrics_desk_source_unique").on(table.deskId, table.sourceId),
		index("sla_metrics_desk_idx").on(table.deskId),
	],
);

export const slaGoals = pgTable(
	"sla_goals",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		metricId: uuid("metric_id")
			.notNull()
			.references(() => slaMetrics.id, { onDelete: "cascade" }),
		jql: text("jql").notNull(),
		goalMinutes: integer("goal_minutes"),
		calendarId: uuid("calendar_id")
			.notNull()
			.references(() => slaCalendars.id, { onDelete: "restrict" }),
		sequence: integer("sequence").notNull().default(0),
		...importedAt,
	},
	(table) => [
		index("sla_goals_metric_sequence_idx").on(table.metricId, table.sequence),
	],
);

export const slaCycles = pgTable(
	"sla_cycles",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		metricId: uuid("metric_id")
			.notNull()
			.references(() => slaMetrics.id, { onDelete: "cascade" }),
		cycleNumber: integer("cycle_number").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		stoppedAt: timestamp("stopped_at", { withTimezone: true }),
		pausedIntervals: jsonb("paused_intervals")
			.$type<{ from: string; to: string }[]>()
			.notNull(),
		goalMinutes: integer("goal_minutes"),
		elapsedMinutes: integer("elapsed_minutes").notNull(),
		breached: boolean("breached").notNull().default(false),
		breachTime: timestamp("breach_time", { withTimezone: true }),
		computedAt: timestamp("computed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		unique("sla_cycles_issue_metric_cycle_unique").on(
			table.issueId,
			table.metricId,
			table.cycleNumber,
		),
		index("sla_cycles_issue_idx").on(table.issueId),
	],
);

/** Cycles as Jira reported them; imported history, not computed state. */
export const slaImportedCycles = pgTable(
	"sla_imported_cycles",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		metricId: uuid("metric_id")
			.notNull()
			.references(() => slaMetrics.id, { onDelete: "cascade" }),
		cycleNumber: integer("cycle_number").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		stoppedAt: timestamp("stopped_at", { withTimezone: true }),
		goalMinutes: integer("goal_minutes"),
		elapsedMinutes: integer("elapsed_minutes").notNull(),
		remainingMinutes: integer("remaining_minutes"),
		breached: boolean("breached").notNull().default(false),
		...importedAt,
	},
	(table) => [
		unique("sla_imported_cycles_issue_metric_cycle_unique").on(
			table.issueId,
			table.metricId,
			table.cycleNumber,
		),
		index("sla_imported_cycles_issue_idx").on(table.issueId),
	],
);

export const automationRules = pgTable(
	"automation_rules",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		deskId: uuid("desk_id").references(() => serviceDesks.id, {
			onDelete: "cascade",
		}),
		name: text("name").notNull(),
		enabled: boolean("enabled").notNull().default(false),
		trigger: jsonb("trigger").$type<Record<string, unknown>>().notNull(),
		conditions: jsonb("conditions")
			.$type<Record<string, unknown>[]>()
			.notNull(),
		actions: jsonb("actions").$type<Record<string, unknown>[]>().notNull(),
		raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
		...importedAt,
	},
	(table) => [index("automation_rules_desk_idx").on(table.deskId)],
);
