import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	customType,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./schema.ts";

const tsvector = customType<{ data: string; driverData: string }>({
	dataType() {
		return "tsvector";
	},
});

const importedAt = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
};

export const spaces = pgTable(
	"spaces",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		key: text("key").notNull().unique(),
		name: text("name").notNull(),
		type: text("type", { enum: ["global", "personal"] })
			.notNull()
			.default("global"),
		descriptionHtml: text("description_html"),
		homePageId: uuid("home_page_id").references((): AnyPgColumn => pages.id, {
			onDelete: "set null",
		}),
		ownerId: uuid("owner_id").references(() => users.id, {
			onDelete: "set null",
		}),
		status: text("status", { enum: ["current", "archived"] })
			.notNull()
			.default("current"),
		iconPath: text("icon_path"),
		iconFile: text("icon_file"),
		iconSource: text("icon_source"),
		created: timestamp("created", { withTimezone: true }),
		creatorId: uuid("creator_id").references(() => users.id, {
			onDelete: "set null",
		}),
		...importedAt,
	},
	(table) => [index("spaces_owner_idx").on(table.ownerId)],
);

export const pages = pgTable(
	"pages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		spaceId: uuid("space_id")
			.notNull()
			.references(() => spaces.id, { onDelete: "cascade" }),
		parentId: uuid("parent_id").references((): AnyPgColumn => pages.id, {
			onDelete: "set null",
		}),
		position: integer("position").notNull().default(0),
		title: text("title").notNull(),
		type: text("type", { enum: ["page", "blogpost"] })
			.notNull()
			.default("page"),
		status: text("status", { enum: ["current", "draft", "trashed"] })
			.notNull()
			.default("current"),
		versionNumber: integer("version_number").notNull().default(1),
		bodyStorage: text("body_storage"),
		bodyHtml: text("body_html"),
		renderedContext: text("rendered_context"),
		bodyDoc: jsonb("body_doc").$type<Record<string, unknown>>(),
		creatorId: uuid("creator_id").references(() => users.id, {
			onDelete: "set null",
		}),
		created: timestamp("created", { withTimezone: true }),
		lastModifierId: uuid("last_modifier_id").references(() => users.id, {
			onDelete: "set null",
		}),
		updated: timestamp("updated", { withTimezone: true }),
		locallyChangedAt: timestamp("locally_changed_at", { withTimezone: true }),
		search: tsvector("search").generatedAlwaysAs(
			sql`to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("body_html", ''))`,
		),
		...importedAt,
	},
	(table) => [
		index("pages_space_idx").on(table.spaceId),
		index("pages_parent_idx").on(table.parentId),
		index("pages_space_parent_position_idx").on(
			table.spaceId,
			table.parentId,
			table.position,
		),
		uniqueIndex("pages_space_title_current_unique")
			.on(table.spaceId, table.title)
			.where(sql`status = 'current'`),
		index("pages_search_gin").using("gin", table.search),
		index("pages_title_trgm_gin").using("gin", table.title.op("gin_trgm_ops")),
	],
);

export const pageVersions = pgTable(
	"page_versions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => pages.id, { onDelete: "cascade" }),
		number: integer("number").notNull(),
		title: text("title"),
		bodyStorage: text("body_storage"),
		bodyHtml: text("body_html"),
		bodyDoc: jsonb("body_doc").$type<Record<string, unknown>>(),
		renderedContext: text("rendered_context"),
		authorId: uuid("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		created: timestamp("created", { withTimezone: true }),
		message: text("message"),
		minorEdit: boolean("minor_edit").notNull().default(false),
		locallyChangedAt: timestamp("locally_changed_at", { withTimezone: true }),
		...importedAt,
	},
	(table) => [
		unique("page_versions_page_number_unique").on(table.pageId, table.number),
		index("page_versions_page_idx").on(table.pageId),
	],
);

export const pageComments = pgTable(
	"page_comments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => pages.id, { onDelete: "cascade" }),
		parentId: uuid("parent_id").references((): AnyPgColumn => pageComments.id, {
			onDelete: "set null",
		}),
		authorId: uuid("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		bodyHtml: text("body_html"),
		bodyStorage: text("body_storage"),
		renderedContext: text("rendered_context"),
		created: timestamp("created", { withTimezone: true }),
		updated: timestamp("updated", { withTimezone: true }),
		inline: boolean("inline").notNull().default(false),
		inlineOriginalSelection: text("inline_original_selection"),
		inlineMarkerRef: text("inline_marker_ref"),
		resolved: boolean("resolved").notNull().default(false),
		locallyChangedAt: timestamp("locally_changed_at", { withTimezone: true }),
		...importedAt,
	},
	(table) => [
		index("page_comments_page_idx").on(table.pageId),
		index("page_comments_parent_idx").on(table.parentId),
	],
);

export const pageAttachments = pgTable(
	"page_attachments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => pages.id, { onDelete: "cascade" }),
		fileName: text("file_name").notNull(),
		mimeType: text("mime_type"),
		size: integer("size").notNull().default(0),
		version: integer("version").notNull().default(1),
		authorId: uuid("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		created: timestamp("created", { withTimezone: true }),
		comment: text("comment"),
		storagePath: text("storage_path").notNull(),
		sha256: text("sha256").notNull(),
		...importedAt,
	},
	(table) => [
		unique("page_attachments_page_file_version_unique").on(
			table.pageId,
			table.fileName,
			table.version,
		),
		index("page_attachments_page_idx").on(table.pageId),
	],
);

export const pageLabels = pgTable(
	"page_labels",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => pages.id, { onDelete: "cascade" }),
		label: text("label").notNull(),
		...importedAt,
	},
	(table) => [
		unique("page_labels_page_label_unique").on(table.pageId, table.label),
		index("page_labels_label_idx").on(table.label),
	],
);

export const pageRestrictions = pgTable(
	"page_restrictions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => pages.id, { onDelete: "cascade" }),
		operation: text("operation", { enum: ["read", "update"] }).notNull(),
		userId: uuid("user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		groupName: text("group_name"),
		...importedAt,
	},
	(table) => [index("page_restrictions_page_idx").on(table.pageId)],
);

export const spacePermissions = pgTable(
	"space_permissions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		spaceId: uuid("space_id")
			.notNull()
			.references(() => spaces.id, { onDelete: "cascade" }),
		permission: text("permission").notNull(),
		userId: uuid("user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		groupName: text("group_name"),
		anonymous: boolean("anonymous").notNull().default(false),
		...importedAt,
	},
	(table) => [index("space_permissions_space_idx").on(table.spaceId)],
);

export const pageTemplates = pgTable(
	"page_templates",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		spaceId: uuid("space_id").references(() => spaces.id, {
			onDelete: "cascade",
		}),
		name: text("name").notNull(),
		description: text("description"),
		bodyStorage: text("body_storage"),
		...importedAt,
	},
	(table) => [index("page_templates_space_idx").on(table.spaceId)],
);
