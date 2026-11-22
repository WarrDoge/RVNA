ALTER TABLE "sla_cycles" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sla_cycles" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "sla_cycles" ADD CONSTRAINT "sla_cycles_goal_id_sla_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."sla_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DELETE FROM "gitlab_automation_events" a
USING "gitlab_automation_events" b
WHERE a.status = 'applied'
	AND b.status = 'applied'
	AND a.merge_request_id IS NOT NULL
	AND a.merge_request_id = b.merge_request_id
	AND a.issue_id = b.issue_id
	AND a.kind = b.kind
	AND a.id > b.id;--> statement-breakpoint
CREATE UNIQUE INDEX "gitlab_automation_events_applied_unique" ON "gitlab_automation_events" USING btree ("merge_request_id","issue_id","kind") WHERE status = 'applied';