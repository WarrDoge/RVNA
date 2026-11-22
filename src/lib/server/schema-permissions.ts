import { sql } from "drizzle-orm";
import {
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { filters, groups, projects } from "./schema.ts";

const importedAt = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
};

export const permissionSchemes = pgTable("permission_schemes", {
	id: uuid("id").primaryKey().defaultRandom(),
	sourceId: text("source_id").notNull().unique(),
	name: text("name").notNull(),
	description: text("description"),
	projectIds: jsonb("project_ids").$type<string[]>().notNull().default([]),
	raw: jsonb("raw").notNull(),
	...importedAt,
});

export const permissionGrants = pgTable(
	"permission_grants",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		schemeId: uuid("scheme_id")
			.notNull()
			.references(() => permissionSchemes.id, { onDelete: "cascade" }),
		permissionKey: text("permission_key").notNull(),
		holderType: text("holder_type").notNull(),
		holderParameter: text("holder_parameter"),
		raw: jsonb("raw").notNull(),
		...importedAt,
	},
	(table) => [index("permission_grants_scheme_idx").on(table.schemeId)],
);

export const projectRoleActors = pgTable(
	"project_role_actors",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		roleId: text("role_id").notNull(),
		roleName: text("role_name").notNull(),
		actorType: text("actor_type").notNull(),
		actorParameter: text("actor_parameter").notNull(),
		actorDisplayName: text("actor_display_name"),
		raw: jsonb("raw").notNull(),
		...importedAt,
	},
	(table) => [
		index("project_role_actors_project_idx").on(table.projectId),
		index("project_role_actors_role_idx").on(table.projectId, table.roleId),
		uniqueIndex("project_role_actors_identity_unique").on(
			table.projectId,
			sql`lower(${table.roleId})`,
			table.actorType,
			sql`lower(${table.actorParameter})`,
		),
	],
);

export const filterShares = pgTable(
	"filter_shares",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		filterId: uuid("filter_id")
			.notNull()
			.references(() => filters.id, { onDelete: "cascade" }),
		projectId: uuid("project_id").references(() => projects.id, {
			onDelete: "cascade",
		}),
		groupId: uuid("group_id").references(() => groups.id, {
			onDelete: "cascade",
		}),
		...importedAt,
	},
	(table) => [
		index("filter_shares_filter_idx").on(table.filterId),
		unique("filter_shares_filter_project_unique").on(
			table.filterId,
			table.projectId,
		),
		unique("filter_shares_filter_group_unique").on(
			table.filterId,
			table.groupId,
		),
		check(
			"filter_shares_one_target_check",
			sql`num_nonnulls(${table.projectId}, ${table.groupId}) = 1`,
		),
	],
);
