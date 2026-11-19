CREATE TABLE "gitlab_automation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid,
	"repository_id" uuid,
	"merge_request_id" uuid,
	"issue_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab_branch_issues" (
	"branch_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	CONSTRAINT "gitlab_branch_issues_branch_id_issue_id_pk" PRIMARY KEY("branch_id","issue_id")
);
--> statement-breakpoint
CREATE TABLE "gitlab_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"name" text NOT NULL,
	"web_url" text,
	"last_commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gitlab_branches_repository_name_unique" UNIQUE("repository_id","name")
);
--> statement-breakpoint
CREATE TABLE "gitlab_commit_issues" (
	"commit_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"smart_commits_applied" boolean DEFAULT false NOT NULL,
	CONSTRAINT "gitlab_commit_issues_commit_id_issue_id_pk" PRIMARY KEY("commit_id","issue_id")
);
--> statement-breakpoint
CREATE TABLE "gitlab_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"author_name" text,
	"author_email" text,
	"committed_at" timestamp with time zone,
	"web_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gitlab_commits_repository_sha_unique" UNIQUE("repository_id","sha")
);
--> statement-breakpoint
CREATE TABLE "gitlab_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"webhook_secret" text,
	"access_token" text,
	"last_delivery_at" timestamp with time zone,
	"last_delivery_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"event" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	CONSTRAINT "gitlab_deliveries_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "gitlab_merge_request_issues" (
	"merge_request_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	CONSTRAINT "gitlab_merge_request_issues_merge_request_id_issue_id_pk" PRIMARY KEY("merge_request_id","issue_id")
);
--> statement-breakpoint
CREATE TABLE "gitlab_merge_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"iid" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"source_branch" text,
	"target_branch" text,
	"author_name" text,
	"author_email" text,
	"reviewers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approvals" integer DEFAULT 0 NOT NULL,
	"web_url" text,
	"gitlab_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gitlab_merge_requests_repository_iid_unique" UNIQUE("repository_id","iid")
);
--> statement-breakpoint
CREATE TABLE "gitlab_pipeline_issues" (
	"pipeline_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	CONSTRAINT "gitlab_pipeline_issues_pipeline_id_issue_id_pk" PRIMARY KEY("pipeline_id","issue_id")
);
--> statement-breakpoint
CREATE TABLE "gitlab_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"gitlab_id" bigint NOT NULL,
	"status" text NOT NULL,
	"ref" text,
	"sha" text,
	"web_url" text,
	"gitlab_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gitlab_pipelines_repository_id_unique" UNIQUE("repository_id","gitlab_id")
);
--> statement-breakpoint
CREATE TABLE "gitlab_project_repositories" (
	"project_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	CONSTRAINT "gitlab_project_repositories_project_id_repository_id_pk" PRIMARY KEY("project_id","repository_id")
);
--> statement-breakpoint
CREATE TABLE "gitlab_project_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"default_repository_id" uuid,
	"smart_commits_enabled" boolean DEFAULT false NOT NULL,
	"merge_request_opened_enabled" boolean DEFAULT false NOT NULL,
	"merge_request_opened_transitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"merge_request_merged_enabled" boolean DEFAULT false NOT NULL,
	"merge_request_merged_transitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gitlab_project_id" integer NOT NULL,
	"path" text NOT NULL,
	"name" text,
	"web_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gitlab_repositories_gitlab_project_id_unique" UNIQUE("gitlab_project_id")
);
--> statement-breakpoint
ALTER TABLE "issue_history" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "gitlab_automation_events" ADD CONSTRAINT "gitlab_automation_events_delivery_id_gitlab_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."gitlab_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_automation_events" ADD CONSTRAINT "gitlab_automation_events_repository_id_gitlab_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."gitlab_repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_automation_events" ADD CONSTRAINT "gitlab_automation_events_merge_request_id_gitlab_merge_requests_id_fk" FOREIGN KEY ("merge_request_id") REFERENCES "public"."gitlab_merge_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_automation_events" ADD CONSTRAINT "gitlab_automation_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_branch_issues" ADD CONSTRAINT "gitlab_branch_issues_branch_id_gitlab_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."gitlab_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_branch_issues" ADD CONSTRAINT "gitlab_branch_issues_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_branches" ADD CONSTRAINT "gitlab_branches_repository_id_gitlab_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."gitlab_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_commit_issues" ADD CONSTRAINT "gitlab_commit_issues_commit_id_gitlab_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."gitlab_commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_commit_issues" ADD CONSTRAINT "gitlab_commit_issues_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_commits" ADD CONSTRAINT "gitlab_commits_repository_id_gitlab_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."gitlab_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_merge_request_issues" ADD CONSTRAINT "gitlab_merge_request_issues_merge_request_id_gitlab_merge_requests_id_fk" FOREIGN KEY ("merge_request_id") REFERENCES "public"."gitlab_merge_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_merge_request_issues" ADD CONSTRAINT "gitlab_merge_request_issues_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_merge_requests" ADD CONSTRAINT "gitlab_merge_requests_repository_id_gitlab_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."gitlab_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_pipeline_issues" ADD CONSTRAINT "gitlab_pipeline_issues_pipeline_id_gitlab_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."gitlab_pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_pipeline_issues" ADD CONSTRAINT "gitlab_pipeline_issues_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_pipelines" ADD CONSTRAINT "gitlab_pipelines_repository_id_gitlab_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."gitlab_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_project_repositories" ADD CONSTRAINT "gitlab_project_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_project_repositories" ADD CONSTRAINT "gitlab_project_repositories_repository_id_gitlab_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."gitlab_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_project_settings" ADD CONSTRAINT "gitlab_project_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_project_settings" ADD CONSTRAINT "gitlab_project_settings_default_repository_id_gitlab_repositories_id_fk" FOREIGN KEY ("default_repository_id") REFERENCES "public"."gitlab_repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gitlab_automation_events_mr_idx" ON "gitlab_automation_events" USING btree ("merge_request_id","kind");--> statement-breakpoint
CREATE INDEX "gitlab_branch_issues_issue_idx" ON "gitlab_branch_issues" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "gitlab_commit_issues_issue_idx" ON "gitlab_commit_issues" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "gitlab_commits_committed_idx" ON "gitlab_commits" USING btree ("committed_at");--> statement-breakpoint
CREATE INDEX "gitlab_deliveries_received_idx" ON "gitlab_deliveries" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "gitlab_merge_request_issues_issue_idx" ON "gitlab_merge_request_issues" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "gitlab_merge_requests_state_idx" ON "gitlab_merge_requests" USING btree ("state");--> statement-breakpoint
CREATE INDEX "gitlab_pipeline_issues_issue_idx" ON "gitlab_pipeline_issues" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "gitlab_pipelines_created_idx" ON "gitlab_pipelines" USING btree ("gitlab_created_at");--> statement-breakpoint
CREATE INDEX "gitlab_repositories_path_idx" ON "gitlab_repositories" USING btree ("path");