import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { permissionSchemes, projects } from "./schema.ts";

/**
 * Imported permission rows that an administrator removed in the app. The
 * importer leaves a tombstoned source id alone, so a re-import cannot bring
 * the row back.
 */
export const permissionLocalRemovals = pgTable("permission_local_removals", {
	sourceId: text("source_id").primaryKey(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * A project assigned to a scheme in the app. The importer re-applies these
 * after it writes Jira's own project lists, so a local assignment survives.
 */
export const permissionLocalAssignments = pgTable(
	"permission_local_assignments",
	{
		projectId: uuid("project_id")
			.primaryKey()
			.references(() => projects.id, { onDelete: "cascade" }),
		schemeId: uuid("scheme_id")
			.notNull()
			.references(() => permissionSchemes.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("permission_local_assignments_scheme_idx").on(table.schemeId),
	],
);
