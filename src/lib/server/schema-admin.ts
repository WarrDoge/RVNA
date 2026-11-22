import {
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { fields, issueTypes, projects, users, workflows } from "./schema.ts";

export const auditLog = pgTable(
	"audit_log",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		actorId: uuid("actor_id").references(() => users.id, {
			onDelete: "set null",
		}),
		actorName: text("actor_name").notNull(),
		action: text("action").notNull(),
		entityType: text("entity_type").notNull(),
		entityId: text("entity_id"),
		summary: text("summary").notNull(),
		changes: jsonb("changes"),
	},
	(table) => [
		index("audit_log_created_idx").on(table.createdAt),
		index("audit_log_action_idx").on(table.action),
		index("audit_log_entity_type_idx").on(table.entityType),
		index("audit_log_actor_id_idx").on(table.actorId),
	],
);

export const fieldContexts = pgTable(
	"field_contexts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		fieldId: uuid("field_id")
			.notNull()
			.references(() => fields.id, { onDelete: "cascade" }),
		projectId: uuid("project_id").references(() => projects.id, {
			onDelete: "cascade",
		}),
		issueTypeId: uuid("issue_type_id").references(() => issueTypes.id, {
			onDelete: "cascade",
		}),
	},
	(table) => [
		unique("field_contexts_unique")
			.on(table.fieldId, table.projectId, table.issueTypeId)
			.nullsNotDistinct(),
	],
);

export const projectPreviousKeys = pgTable("project_previous_keys", {
	id: uuid("id").primaryKey().defaultRandom(),
	projectId: uuid("project_id")
		.notNull()
		.references(() => projects.id, { onDelete: "cascade" }),
	key: text("key").notNull().unique(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const workflowDrafts = pgTable("workflow_drafts", {
	workflowId: uuid("workflow_id")
		.primaryKey()
		.references(() => workflows.id, { onDelete: "cascade" }),
	definition: jsonb("definition").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
	updatedBy: uuid("updated_by").references(() => users.id, {
		onDelete: "set null",
	}),
});

export const appSettings = pgTable("app_settings", {
	key: text("key").primaryKey(),
	value: jsonb("value").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const loginThrottle = pgTable(
	"login_throttle",
	{
		kind: text("kind", { enum: ["user", "ip"] }).notNull(),
		key: text("key").notNull(),
		failures: integer("failures").notNull().default(0),
		lastFailureAt: timestamp("last_failure_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		lockedUntil: timestamp("locked_until", { withTimezone: true }),
	},
	(table) => [primaryKey({ columns: [table.kind, table.key] })],
);
