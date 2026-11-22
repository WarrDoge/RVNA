ALTER TABLE "sla_goals" DROP CONSTRAINT "sla_goals_metric_sequence_unique";--> statement-breakpoint
CREATE INDEX "sla_goals_metric_sequence_idx" ON "sla_goals" USING btree ("metric_id","sequence");