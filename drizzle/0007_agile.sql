CREATE TABLE "board_column_statuses" (
	"column_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "board_column_statuses_column_id_status_id_pk" PRIMARY KEY("column_id","status_id")
);
--> statement-breakpoint
CREATE TABLE "board_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"min_issues" integer,
	"max_issues" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_quick_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"jql" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_swimlanes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"jql" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rapid_view_id" integer NOT NULL,
	"source_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"filter_jql" text NOT NULL,
	"project_id" uuid,
	"estimation_field" text DEFAULT 'story_points' NOT NULL,
	"swimlane_strategy" text DEFAULT 'none' NOT NULL,
	"card_colour_strategy" text DEFAULT 'none' NOT NULL,
	"sub_filter_jql" text,
	"kanban_backlog_status_id" uuid,
	"owner_id" uuid,
	"config_imported" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_rapid_view_id_unique" UNIQUE("rapid_view_id"),
	CONSTRAINT "boards_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "issue_sprints" (
	"issue_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_sprints_issue_id_sprint_id_pk" PRIMARY KEY("issue_id","sprint_id")
);
--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"state" text DEFAULT 'future' NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"complete_date" timestamp with time zone,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprints_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
ALTER TABLE "board_column_statuses" ADD CONSTRAINT "board_column_statuses_column_id_board_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."board_columns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_column_statuses" ADD CONSTRAINT "board_column_statuses_status_id_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_quick_filters" ADD CONSTRAINT "board_quick_filters_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_swimlanes" ADD CONSTRAINT "board_swimlanes_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_kanban_backlog_status_id_statuses_id_fk" FOREIGN KEY ("kanban_backlog_status_id") REFERENCES "public"."statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sprints" ADD CONSTRAINT "issue_sprints_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_sprints" ADD CONSTRAINT "issue_sprints_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_column_statuses_status_idx" ON "board_column_statuses" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "board_columns_board_idx" ON "board_columns" USING btree ("board_id","sequence");--> statement-breakpoint
CREATE INDEX "board_quick_filters_board_idx" ON "board_quick_filters" USING btree ("board_id","sequence");--> statement-breakpoint
CREATE INDEX "board_swimlanes_board_idx" ON "board_swimlanes" USING btree ("board_id","sequence");--> statement-breakpoint
CREATE INDEX "boards_project_idx" ON "boards" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "issue_sprints_sprint_idx" ON "issue_sprints" USING btree ("sprint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_sprints_one_open_unique" ON "issue_sprints" USING btree ("issue_id") WHERE "issue_sprints"."is_open";--> statement-breakpoint
CREATE INDEX "sprints_board_idx" ON "sprints" USING btree ("board_id","sequence");