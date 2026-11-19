import {
	bigint,
	boolean,
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
import { issues, projects } from "./schema.ts";

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
};

export const gitlabConfig = pgTable("gitlab_config", {
	id: integer("id").primaryKey().default(1),
	baseUrl: text("base_url").notNull().default(""),
	webhookSecret: text("webhook_secret"),
	accessToken: text("access_token"),
	lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
	lastDeliveryStatus: text("last_delivery_status"),
	...timestamps,
});

export const gitlabRepositories = pgTable(
	"gitlab_repositories",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		gitlabProjectId: integer("gitlab_project_id").notNull().unique(),
		path: text("path").notNull(),
		name: text("name"),
		webUrl: text("web_url").notNull(),
		...timestamps,
	},
	(table) => [index("gitlab_repositories_path_idx").on(table.path)],
);

export const gitlabBranches = pgTable(
	"gitlab_branches",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		repositoryId: uuid("repository_id")
			.notNull()
			.references(() => gitlabRepositories.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		webUrl: text("web_url"),
		lastCommitSha: text("last_commit_sha"),
		...timestamps,
	},
	(table) => [
		unique("gitlab_branches_repository_name_unique").on(
			table.repositoryId,
			table.name,
		),
	],
);

export const gitlabCommits = pgTable(
	"gitlab_commits",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		repositoryId: uuid("repository_id")
			.notNull()
			.references(() => gitlabRepositories.id, { onDelete: "cascade" }),
		sha: text("sha").notNull(),
		title: text("title").notNull(),
		message: text("message"),
		authorName: text("author_name"),
		authorEmail: text("author_email"),
		committedAt: timestamp("committed_at", { withTimezone: true }),
		webUrl: text("web_url"),
		...timestamps,
	},
	(table) => [
		unique("gitlab_commits_repository_sha_unique").on(
			table.repositoryId,
			table.sha,
		),
		index("gitlab_commits_committed_idx").on(table.committedAt),
	],
);

export const gitlabMergeRequests = pgTable(
	"gitlab_merge_requests",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		repositoryId: uuid("repository_id")
			.notNull()
			.references(() => gitlabRepositories.id, { onDelete: "cascade" }),
		iid: integer("iid").notNull(),
		title: text("title").notNull(),
		state: text("state", {
			enum: ["opened", "merged", "closed", "locked"],
		}).notNull(),
		sourceBranch: text("source_branch"),
		targetBranch: text("target_branch"),
		authorName: text("author_name"),
		authorEmail: text("author_email"),
		reviewers: jsonb("reviewers").notNull().default([]),
		approvals: integer("approvals").notNull().default(0),
		webUrl: text("web_url"),
		gitlabUpdatedAt: timestamp("gitlab_updated_at", { withTimezone: true }),
		...timestamps,
	},
	(table) => [
		unique("gitlab_merge_requests_repository_iid_unique").on(
			table.repositoryId,
			table.iid,
		),
		index("gitlab_merge_requests_state_idx").on(table.state),
	],
);

export const gitlabPipelines = pgTable(
	"gitlab_pipelines",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		repositoryId: uuid("repository_id")
			.notNull()
			.references(() => gitlabRepositories.id, { onDelete: "cascade" }),
		gitlabId: bigint("gitlab_id", { mode: "number" }).notNull(),
		status: text("status").notNull(),
		ref: text("ref"),
		sha: text("sha"),
		webUrl: text("web_url"),
		gitlabCreatedAt: timestamp("gitlab_created_at", { withTimezone: true }),
		...timestamps,
	},
	(table) => [
		unique("gitlab_pipelines_repository_id_unique").on(
			table.repositoryId,
			table.gitlabId,
		),
		index("gitlab_pipelines_created_idx").on(table.gitlabCreatedAt),
	],
);

export const gitlabBranchIssues = pgTable(
	"gitlab_branch_issues",
	{
		branchId: uuid("branch_id")
			.notNull()
			.references(() => gitlabBranches.id, { onDelete: "cascade" }),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.branchId, table.issueId] }),
		index("gitlab_branch_issues_issue_idx").on(table.issueId),
	],
);

export const gitlabCommitIssues = pgTable(
	"gitlab_commit_issues",
	{
		commitId: uuid("commit_id")
			.notNull()
			.references(() => gitlabCommits.id, { onDelete: "cascade" }),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		smartCommitsApplied: boolean("smart_commits_applied")
			.notNull()
			.default(false),
	},
	(table) => [
		primaryKey({ columns: [table.commitId, table.issueId] }),
		index("gitlab_commit_issues_issue_idx").on(table.issueId),
	],
);

export const gitlabMergeRequestIssues = pgTable(
	"gitlab_merge_request_issues",
	{
		mergeRequestId: uuid("merge_request_id")
			.notNull()
			.references(() => gitlabMergeRequests.id, { onDelete: "cascade" }),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.mergeRequestId, table.issueId] }),
		index("gitlab_merge_request_issues_issue_idx").on(table.issueId),
	],
);

export const gitlabPipelineIssues = pgTable(
	"gitlab_pipeline_issues",
	{
		pipelineId: uuid("pipeline_id")
			.notNull()
			.references(() => gitlabPipelines.id, { onDelete: "cascade" }),
		issueId: uuid("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.pipelineId, table.issueId] }),
		index("gitlab_pipeline_issues_issue_idx").on(table.issueId),
	],
);

export const gitlabProjectRepositories = pgTable(
	"gitlab_project_repositories",
	{
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		repositoryId: uuid("repository_id")
			.notNull()
			.references(() => gitlabRepositories.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.projectId, table.repositoryId] })],
);

export const gitlabProjectSettings = pgTable("gitlab_project_settings", {
	projectId: uuid("project_id")
		.primaryKey()
		.references(() => projects.id, { onDelete: "cascade" }),
	defaultRepositoryId: uuid("default_repository_id").references(
		() => gitlabRepositories.id,
		{ onDelete: "set null" },
	),
	smartCommitsEnabled: boolean("smart_commits_enabled")
		.notNull()
		.default(false),
	mergeRequestOpenedEnabled: boolean("merge_request_opened_enabled")
		.notNull()
		.default(false),
	mergeRequestOpenedTransitions: jsonb("merge_request_opened_transitions")
		.notNull()
		.default([]),
	mergeRequestMergedEnabled: boolean("merge_request_merged_enabled")
		.notNull()
		.default(false),
	mergeRequestMergedTransitions: jsonb("merge_request_merged_transitions")
		.notNull()
		.default([]),
	...timestamps,
});

export const gitlabDeliveries = pgTable(
	"gitlab_deliveries",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		idempotencyKey: text("idempotency_key").notNull().unique(),
		event: text("event").notNull(),
		status: text("status", {
			enum: ["queued", "processing", "processed", "ignored", "failed"],
		})
			.notNull()
			.default("queued"),
		reason: text("reason"),
		payload: jsonb("payload").notNull(),
		receivedAt: timestamp("received_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		processedAt: timestamp("processed_at", { withTimezone: true }),
	},
	(table) => [index("gitlab_deliveries_received_idx").on(table.receivedAt)],
);

export const gitlabAutomationEvents = pgTable(
	"gitlab_automation_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		deliveryId: uuid("delivery_id").references(() => gitlabDeliveries.id, {
			onDelete: "set null",
		}),
		repositoryId: uuid("repository_id").references(
			() => gitlabRepositories.id,
			{ onDelete: "set null" },
		),
		mergeRequestId: uuid("merge_request_id").references(
			() => gitlabMergeRequests.id,
			{ onDelete: "set null" },
		),
		issueId: uuid("issue_id").references(() => issues.id, {
			onDelete: "cascade",
		}),
		kind: text("kind").notNull(),
		status: text("status", { enum: ["applied", "ignored"] }).notNull(),
		reason: text("reason"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("gitlab_automation_events_mr_idx").on(
			table.mergeRequestId,
			table.kind,
		),
	],
);
