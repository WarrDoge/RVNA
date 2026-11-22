CREATE TABLE "permission_local_unassignments" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "sprint_reports_sprint_idx";--> statement-breakpoint
DROP INDEX "queues_desk_idx";--> statement-breakpoint
DROP INDEX "request_type_groups_desk_idx";--> statement-breakpoint
DROP INDEX "request_types_desk_idx";--> statement-breakpoint
DROP INDEX "sla_cycles_issue_idx";--> statement-breakpoint
DROP INDEX "sla_imported_cycles_issue_idx";--> statement-breakpoint
DROP INDEX "sla_metrics_desk_idx";--> statement-breakpoint
ALTER TABLE "permission_local_unassignments" ADD CONSTRAINT "permission_local_unassignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_batches_pending_idx" ON "email_batches" USING btree ("send_after") WHERE "email_batches"."sent_at" is null;--> statement-breakpoint
-- Rows written before the constraint may have no target or both; keep the project as the readers did.
DELETE FROM "filter_shares" WHERE "project_id" IS NULL AND "group_id" IS NULL;--> statement-breakpoint
UPDATE "filter_shares" SET "group_id" = NULL WHERE "project_id" IS NOT NULL AND "group_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "filter_shares" ADD CONSTRAINT "filter_shares_one_target_check" CHECK (num_nonnulls("filter_shares"."project_id", "filter_shares"."group_id") = 1);