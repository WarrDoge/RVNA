import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	customType,
	date,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
// schema-servicedesk imports back from this module. Its references() callbacks
// run after both modules are evaluated, so it must not read a table eagerly.
import { requestTypes } from "./schema-servicedesk.ts";

export const users = pgTable(
	"users",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		oidcSub: text("oidc_sub").unique(),
		sourceKey: text("source_key").unique(),
		username: text("username").notNull().unique(),
		email: text("email"),
		displayName: text("display_name").notNull(),
		avatarUrl: text("avatar_url"),
		avatarFile: text("avatar_file"),
		avatarSource: text("avatar_source"),
		active: boolean("active").notNull().default(true),
		isAdmin: boolean("is_admin").notNull().default(false),
		adminLocal: boolean("admin_local").notNull().default(false),
		lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
		passwordHash: text("password_hash"),
		passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
		mustChangePassword: boolean("must_change_password")
			.notNull()
			.default(false),
		messengerMatrixId: text("messenger_matrix_id").unique(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("users_username_lower_unique").on(
			sql`lower(${table.username})`,
		),
	],
);

export const groups = pgTable(
	"groups",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull().unique(),
		local: boolean("local").notNull().default(false),
	},
	(table) => [
		uniqueIndex("groups_name_lower_unique").on(sql`lower(${table.name})`),
	],
);

// A user can be a member of one group through several sources (oidc, jira,
// local), so the source is part of the identity; callers dedupe by group.
export const userGroups = pgTable(
	"user_groups",
	{
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		groupId: uuid("group_id")
			.notNull()
			.references(() => groups.id, { onDelete: "cascade" }),
		source: text("source").notNull().default("oidc"),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.groupId, table.source] }),
	],
);

export const sessions = pgTable(
	"sessions",
	{
		idHash: text("id_hash").primaryKey(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		idToken: text("id_token"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const oidcTransactions = pgTable(
	"oidc_transactions",
	{
		idHash: text("id_hash").primaryKey(),
		state: text("state").notNull(),
		nonce: text("nonce").notNull(),
		codeVerifier: text("code_verifier").notNull(),
		returnTo: text("return_to").notNull(),
		clientIp: text("client_ip"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("oidc_transactions_created_at_idx").on(table.createdAt),
		index("oidc_transactions_client_ip_created_at_idx").on(
			table.clientIp,
			table.createdAt,
		),
	],
);

export const apiTokens = pgTable(
	"api_tokens",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
	},
	(table) => [index("api_tokens_user_id_idx").on(table.userId)],
);

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

export const projects = pgTable("projects", {
	id: uuid("id").primaryKey().defaultRandom(),
	sourceId: text("source_id").notNull().unique(),
	key: text("key").notNull().unique(),
	name: text("name").notNull(),
	description: text("description"),
	leadId: uuid("lead_id").references(() => users.id, {
		onDelete: "set null",
	}),
	projectType: text("project_type", {
		enum: ["software", "service_desk"],
	}).notNull(),
	avatarUrl: text("avatar_url"),
	avatarFile: text("avatar_file"),
	categoryName: text("category_name"),
	archived: boolean("archived").notNull().default(false),
	lastIssueNumber: integer("last_issue_number").notNull().default(0),
	...importedAt,
});

export const issueTypes = pgTable("issue_types", {
	id: uuid("id").primaryKey().defaultRandom(),
	sourceId: text("source_id").notNull().unique(),
	name: text("name").notNull(),
	description: text("description"),
	subtask: boolean("subtask").notNull().default(false),
	iconUrl: text("icon_url"),
	iconFile: text("icon_file"),
	...importedAt,
});

export const priorities = pgTable("priorities", {
	id: uuid("id").primaryKey().defaultRandom(),
	sourceId: text("source_id").notNull().unique(),
	name: text("name").notNull(),
	sequence: integer("sequence").notNull().default(0),
	iconColor: text("icon_color"),
	iconUrl: text("icon_url"),
	iconFile: text("icon_file"),
	...importedAt,
});

export const resolutions = pgTable("resolutions", {
	id: uuid("id").primaryKey().defaultRandom(),
	sourceId: text("source_id").notNull().unique(),
	name: text("name").notNull(),
	description: text("description"),
	sequence: integer("sequence").notNull().default(0),
	...importedAt,
});

export const statuses = pgTable("statuses", {
	id: uuid("id").primaryKey().defaultRandom(),
	sourceId: text("source_id").notNull().unique(),
	name: text("name").notNull(),
	category: text("category", {
		enum: ["new", "indeterminate", "done"],
	}).notNull(),
	...importedAt,
});

export const linkTypes = pgTable("link_types", {
	id: uuid("id").primaryKey().defaultRandom(),
	sourceId: text("source_id").notNull().unique(),
	name: text("name").notNull(),
	inward: text("inward").notNull(),
	outward: text("outward").notNull(),
	...importedAt,
});

export const workflows = pgTable(
	"workflows",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		name: text("name").notNull(),
		description: text("description"),
		initialStatusId: uuid("initial_status_id").references(() => statuses.id, {
			onDelete: "set null",
		}),
		...importedAt,
	},
	(table) => [unique("workflows_name_unique").on(table.name)],
);

export const workflowStatuses = pgTable(
	"workflow_statuses",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		workflowId: uuid("workflow_id")
			.notNull()
			.references(() => workflows.id, { onDelete: "cascade" }),
		statusId: uuid("status_id")
			.notNull()
			.references(() => statuses.id, { onDelete: "restrict" }),
		...importedAt,
	},
	(table) => [
		unique("workflow_statuses_workflow_status_unique").on(
			table.workflowId,
			table.statusId,
		),
	],
);

export const workflowTransitions = pgTable(
	"workflow_transitions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id"),
		workflowId: uuid("workflow_id")
			.notNull()
			.references(() => workflows.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		fromStatusId: uuid("from_status_id").references(() => statuses.id, {
			onDelete: "restrict",
		}),
		toStatusId: uuid("to_status_id")
			.notNull()
			.references(() => statuses.id, { onDelete: "restrict" }),
		asksResolution: boolean("asks_resolution").notNull().default(false),
		sequence: integer("sequence").notNull().default(0),
		...importedAt,
	},
	(table) => [
		unique("workflow_transitions_workflow_source_unique").on(
			table.workflowId,
			table.sourceId,
		),
	],
);

export const projectWorkflows = pgTable(
	"project_workflows",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		issueTypeId: uuid("issue_type_id").references(() => issueTypes.id, {
			onDelete: "cascade",
		}),
		workflowId: uuid("workflow_id")
			.notNull()
			.references(() => workflows.id, { onDelete: "restrict" }),
		...importedAt,
	},
	(table) => [
		unique("project_workflows_project_issue_type_unique")
			.on(table.projectId, table.issueTypeId)
			.nullsNotDistinct(),
	],
);

export const projectIssueTypes = pgTable(
	"project_issue_types",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		issueTypeId: uuid("issue_type_id")
			.notNull()
			.references(() => issueTypes.id, { onDelete: "cascade" }),
		...importedAt,
	},
	(table) => [
		unique("project_issue_types_project_type_unique").on(
			table.projectId,
			table.issueTypeId,
		),
	],
);

export const components = pgTable(
	"components",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		leadId: uuid("lead_id").references(() => users.id, {
			onDelete: "set null",
		}),
		...importedAt,
	},
	(table) => [index("components_project_idx").on(table.projectId)],
);

export const versions = pgTable(
	"versions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		startDate: date("start_date"),
		releaseDate: date("release_date"),
		released: boolean("released").notNull().default(false),
		archived: boolean("archived").notNull().default(false),
		sequence: integer("sequence").notNull().default(0),
		...importedAt,
	},
	(table) => [index("versions_project_idx").on(table.projectId)],
);

export const fields = pgTable("fields", {
	id: uuid("id").primaryKey().defaultRandom(),
	sourceId: text("source_id").notNull().unique(),
	name: text("name").notNull(),
	description: text("description"),
	type: text("type"),
	customKey: text("custom_key"),
	required: boolean("required").notNull().default(false),
	...importedAt,
});

export const fieldOptions = pgTable(
	"field_options",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull(),
		fieldId: uuid("field_id")
			.notNull()
			.references(() => fields.id, { onDelete: "cascade" }),
		value: text("value").notNull(),
		parentOptionId: uuid("parent_option_id").references(
			(): AnyPgColumn => fieldOptions.id,
			{ onDelete: "cascade" },
		),
		sequence: integer("sequence").notNull().default(0),
		disabled: boolean("disabled").notNull().default(false),
		...importedAt,
	},
	(table) => [
		unique("field_options_field_source_unique").on(
			table.fieldId,
			table.sourceId,
		),
	],
);

export const issues = pgTable(
	"issues",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		number: integer("number").notNull(),
		key: text("key").notNull().unique(),
		typeId: uuid("type_id")
			.notNull()
			.references(() => issueTypes.id, { onDelete: "restrict" }),
		statusId: uuid("status_id")
			.notNull()
			.references(() => statuses.id, { onDelete: "restrict" }),
		priorityId: uuid("priority_id").references(() => priorities.id, {
			onDelete: "restrict",
		}),
		resolutionId: uuid("resolution_id").references(() => resolutions.id, {
			onDelete: "restrict",
		}),
		requestTypeId: uuid("request_type_id").references(() => requestTypes.id, {
			onDelete: "set null",
		}),
		requestChannel: text("request_channel", {
			enum: ["portal", "email", "agent", "api", "chat"],
		}),
		summary: text("summary").notNull(),
		descriptionHtml: text("description_html"),
		descriptionSource: text("description_source"),
		reporterId: uuid("reporter_id").references(() => users.id, {
			onDelete: "set null",
		}),
		assigneeId: uuid("assignee_id").references(() => users.id, {
			onDelete: "set null",
		}),
		creatorId: uuid("creator_id").references(() => users.id, {
			onDelete: "set null",
		}),
		parentId: uuid("parent_id").references((): AnyPgColumn => issues.id, {
			onDelete: "set null",
		}),
		epicId: uuid("epic_id").references((): AnyPgColumn => issues.id, {
			onDelete: "set null",
		}),
		storyPoints: doublePrecision("story_points"),
		originalEstimate: integer("original_estimate"),
		remainingEstimate: integer("remaining_estimate"),
		timeSpent: integer("time_spent"),
		dueDate: date("due_date"),
		environment: text("environment"),
		created: timestamp("created", { withTimezone: true }),
		updated: timestamp("updated", { withTimezone: true }),
		resolved: timestamp("resolved", { withTimezone: true }),
		rank: text("rank"),
		custom: jsonb("custom").notNull().default({}),
		locallyChangedAt: timestamp("locally_changed_at", { withTimezone: true }),
		search: tsvector("search").generatedAlwaysAs(
			sql`to_tsvector('simple', coalesce("key", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("description_source", ''))`,
		),
		...importedAt,
	},
	(table) => [
		unique("issues_project_number_unique").on(table.projectId, table.number),
		index("issues_project_idx").on(table.projectId),
		index("issues_type_idx").on(table.typeId),
		index("issues_status_idx").on(table.statusId),
		index("issues_request_type_idx").on(table.requestTypeId),
		index("issues_assignee_idx").on(table.assigneeId),
		index("issues_parent_idx").on(table.parentId),
		index("issues_epic_idx").on(table.epicId),
		index("issues_created_idx").on(table.created),
		index("issues_updated_idx").on(table.updated),
		index("issues_search_gin").using("gin", table.search),
		index("issues_summary_trgm_gin").using(
			"gin",
			table.summary.op("gin_trgm_ops"),
		),
	],
);

export const filters = pgTable(
	"filters",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		description: text("description"),
		jql: text("jql").notNull(),
		ownerId: uuid("owner_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		columns: jsonb("columns").notNull().default([]),
		shared: boolean("shared").notNull().default(false),
		sourceId: text("source_id").unique(),
		...importedAt,
	},
	(table) => [index("filters_owner_idx").on(table.ownerId)],
);

export const filterFavourites = pgTable(
	"filter_favourites",
	{
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		filterId: uuid("filter_id")
			.notNull()
			.references(() => filters.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.filterId] })],
);

export const issueViews = pgTable(
	"issue_views",
	{
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		viewedAt: timestamp("viewed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.issueId] }),
		index("issue_views_viewed_idx").on(table.userId, table.viewedAt),
	],
);

export const userPreferences = pgTable("user_preferences", {
	userId: uuid("user_id")
		.primaryKey()
		.references(() => users.id, { onDelete: "cascade" }),
	navigatorView: text("navigator_view", { enum: ["list", "detail"] })
		.notNull()
		.default("list"),
	columns: jsonb("columns").notNull().default([]),
	timeZone: text("time_zone"),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const issueLabels = pgTable(
	"issue_labels",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		label: text("label").notNull(),
		...importedAt,
	},
	(table) => [
		unique("issue_labels_issue_label_unique").on(table.issueId, table.label),
	],
);

export const issueComponents = pgTable(
	"issue_components",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		componentId: uuid("component_id")
			.notNull()
			.references(() => components.id, { onDelete: "cascade" }),
		...importedAt,
	},
	(table) => [
		unique("issue_components_issue_component_unique").on(
			table.issueId,
			table.componentId,
		),
	],
);

export const issueFixVersions = pgTable(
	"issue_fix_versions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		versionId: uuid("version_id")
			.notNull()
			.references(() => versions.id, { onDelete: "cascade" }),
		...importedAt,
	},
	(table) => [
		unique("issue_fix_versions_issue_version_unique").on(
			table.issueId,
			table.versionId,
		),
	],
);

export const issueAffectsVersions = pgTable(
	"issue_affects_versions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		versionId: uuid("version_id")
			.notNull()
			.references(() => versions.id, { onDelete: "cascade" }),
		...importedAt,
	},
	(table) => [
		unique("issue_affects_versions_issue_version_unique").on(
			table.issueId,
			table.versionId,
		),
	],
);

export const comments = pgTable(
	"comments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		authorId: uuid("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		bodyHtml: text("body_html"),
		bodySource: text("body_source"),
		created: timestamp("created", { withTimezone: true }),
		updated: timestamp("updated", { withTimezone: true }),
		internal: boolean("internal").notNull().default(false),
		locallyChangedAt: timestamp("locally_changed_at", { withTimezone: true }),
		...importedAt,
	},
	(table) => [index("comments_issue_idx").on(table.issueId)],
);

export const worklogs = pgTable(
	"worklogs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		authorId: uuid("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		started: timestamp("started", { withTimezone: true }),
		seconds: integer("seconds").notNull().default(0),
		comment: text("comment"),
		locallyChangedAt: timestamp("locally_changed_at", { withTimezone: true }),
		...importedAt,
	},
	(table) => [index("worklogs_issue_idx").on(table.issueId)],
);

export const watchers = pgTable(
	"watchers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		...importedAt,
	},
	(table) => [
		unique("watchers_issue_user_unique").on(table.issueId, table.userId),
	],
);

export const issueLinks = pgTable(
	"issue_links",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		typeId: uuid("type_id")
			.notNull()
			.references(() => linkTypes.id, { onDelete: "restrict" }),
		sourceIssueId: uuid("source_issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		targetIssueId: uuid("target_issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		locallyChangedAt: timestamp("locally_changed_at", { withTimezone: true }),
		...importedAt,
	},
	(table) => [
		index("issue_links_source_idx").on(table.sourceIssueId),
		index("issue_links_target_idx").on(table.targetIssueId),
	],
);

export const attachments = pgTable(
	"attachments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		fileName: text("file_name").notNull(),
		mimeType: text("mime_type"),
		size: integer("size").notNull().default(0),
		authorId: uuid("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		created: timestamp("created", { withTimezone: true }),
		storagePath: text("storage_path").notNull(),
		sha256: text("sha256").notNull(),
		...importedAt,
	},
	(table) => [index("attachments_issue_idx").on(table.issueId)],
);

export const issueHistory = pgTable(
	"issue_history",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").notNull().unique(),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		authorId: uuid("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		created: timestamp("created", { withTimezone: true }),
		via: text("via"),
		...importedAt,
	},
	(table) => [index("issue_history_issue_idx").on(table.issueId)],
);

export const issueHistoryItems = pgTable(
	"issue_history_items",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: text("source_id").unique(),
		historyId: uuid("history_id")
			.notNull()
			.references(() => issueHistory.id, { onDelete: "cascade" }),
		field: text("field").notNull(),
		fieldType: text("field_type"),
		fromValue: text("from_value"),
		fromText: text("from_string"),
		toValue: text("to_value"),
		toText: text("to_string"),
		sequence: integer("sequence").notNull().default(0),
		...importedAt,
	},
	(table) => [
		unique("issue_history_items_history_sequence_unique").on(
			table.historyId,
			table.sequence,
		),
	],
);

export * from "./schema-admin.ts";
export * from "./schema-agile.ts";
export * from "./schema-dashboards.ts";
export * from "./schema-gitlab.ts";
export * from "./schema-messenger.ts";
export * from "./schema-notifications.ts";
export * from "./schema-permissions.ts";
export * from "./schema-project-roles.ts";
export * from "./schema-reports.ts";
export * from "./schema-servicedesk.ts";
export * from "./schema-wiki.ts";
export * from "./schema-wiki-edit.ts";
export * from "./schema-wiki-social.ts";
