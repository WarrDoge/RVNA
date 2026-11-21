ALTER TABLE "filter_shares" DROP CONSTRAINT "filter_shares_filter_project_unique";--> statement-breakpoint
ALTER TABLE "filter_shares" DROP CONSTRAINT "filter_shares_filter_group_unique";--> statement-breakpoint
ALTER TABLE "filter_shares" ADD CONSTRAINT "filter_shares_filter_project_unique" UNIQUE("filter_id","project_id");--> statement-breakpoint
ALTER TABLE "filter_shares" ADD CONSTRAINT "filter_shares_filter_group_unique" UNIQUE("filter_id","group_id");