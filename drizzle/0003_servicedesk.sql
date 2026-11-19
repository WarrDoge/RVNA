CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"desk_id" uuid,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rules_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "queues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"desk_id" uuid NOT NULL,
	"name" text NOT NULL,
	"jql" text NOT NULL,
	"columns" jsonb NOT NULL,
	"issue_count" integer,
	"sequence" integer DEFAULT 0 NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queues_desk_source_unique" UNIQUE("desk_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "request_type_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type_id" uuid NOT NULL,
	"field_id" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"required" boolean DEFAULT false NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"hidden_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_type_fields_type_field_unique" UNIQUE("request_type_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "request_type_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_type_group_members_type_group_unique" UNIQUE("request_type_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "request_type_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"desk_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_type_groups_desk_source_unique" UNIQUE("desk_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "request_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"desk_id" uuid NOT NULL,
	"issue_type_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"help_text" text,
	"icon_name" text,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_types_desk_source_unique" UNIQUE("desk_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "service_desks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"portal_name" text NOT NULL,
	"description" text,
	"announcement" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_desks_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "sla_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"working_hours" jsonb NOT NULL,
	"holidays" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_calendars_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "sla_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"metric_id" uuid NOT NULL,
	"cycle_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"paused_intervals" jsonb NOT NULL,
	"goal_minutes" integer,
	"elapsed_minutes" integer NOT NULL,
	"breached" boolean DEFAULT false NOT NULL,
	"breach_time" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_cycles_issue_metric_cycle_unique" UNIQUE("issue_id","metric_id","cycle_number")
);
--> statement-breakpoint
CREATE TABLE "sla_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"metric_id" uuid NOT NULL,
	"jql" text NOT NULL,
	"goal_minutes" integer,
	"calendar_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_goals_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "sla_goals_metric_sequence_unique" UNIQUE("metric_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "sla_imported_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"metric_id" uuid NOT NULL,
	"cycle_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"goal_minutes" integer,
	"elapsed_minutes" integer NOT NULL,
	"remaining_minutes" integer,
	"breached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_imported_cycles_issue_metric_cycle_unique" UNIQUE("issue_id","metric_id","cycle_number")
);
--> statement-breakpoint
CREATE TABLE "sla_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"desk_id" uuid NOT NULL,
	"name" text NOT NULL,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"start_conditions" jsonb NOT NULL,
	"pause_conditions" jsonb NOT NULL,
	"stop_conditions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_metrics_desk_source_unique" UNIQUE("desk_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "request_type_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "request_channel" text;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_desk_id_service_desks_id_fk" FOREIGN KEY ("desk_id") REFERENCES "public"."service_desks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_desk_id_service_desks_id_fk" FOREIGN KEY ("desk_id") REFERENCES "public"."service_desks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_parent_id_queues_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."queues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type_fields" ADD CONSTRAINT "request_type_fields_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type_group_members" ADD CONSTRAINT "request_type_group_members_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type_group_members" ADD CONSTRAINT "request_type_group_members_group_id_request_type_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."request_type_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type_groups" ADD CONSTRAINT "request_type_groups_desk_id_service_desks_id_fk" FOREIGN KEY ("desk_id") REFERENCES "public"."service_desks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_desk_id_service_desks_id_fk" FOREIGN KEY ("desk_id") REFERENCES "public"."service_desks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_issue_type_id_issue_types_id_fk" FOREIGN KEY ("issue_type_id") REFERENCES "public"."issue_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_desks" ADD CONSTRAINT "service_desks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_cycles" ADD CONSTRAINT "sla_cycles_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_cycles" ADD CONSTRAINT "sla_cycles_metric_id_sla_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."sla_metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_goals" ADD CONSTRAINT "sla_goals_metric_id_sla_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."sla_metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_goals" ADD CONSTRAINT "sla_goals_calendar_id_sla_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."sla_calendars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_imported_cycles" ADD CONSTRAINT "sla_imported_cycles_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_imported_cycles" ADD CONSTRAINT "sla_imported_cycles_metric_id_sla_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."sla_metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_metrics" ADD CONSTRAINT "sla_metrics_desk_id_service_desks_id_fk" FOREIGN KEY ("desk_id") REFERENCES "public"."service_desks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rules_desk_idx" ON "automation_rules" USING btree ("desk_id");--> statement-breakpoint
CREATE INDEX "queues_desk_idx" ON "queues" USING btree ("desk_id");--> statement-breakpoint
CREATE INDEX "request_type_groups_desk_idx" ON "request_type_groups" USING btree ("desk_id");--> statement-breakpoint
CREATE INDEX "request_types_desk_idx" ON "request_types" USING btree ("desk_id");--> statement-breakpoint
CREATE INDEX "service_desks_project_idx" ON "service_desks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sla_cycles_issue_idx" ON "sla_cycles" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "sla_imported_cycles_issue_idx" ON "sla_imported_cycles" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "sla_metrics_desk_idx" ON "sla_metrics" USING btree ("desk_id");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issues_request_type_idx" ON "issues" USING btree ("request_type_id");