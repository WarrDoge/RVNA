-- Imports used to mark every shared Jira filter and every dashboard as visible to everyone.
-- The next jira-dashboards run restores the real filter shares; dashboards stay private until an administrator shares them.
UPDATE "filters" SET "shared" = false WHERE "source_id" IS NOT NULL;--> statement-breakpoint
UPDATE "dashboards" SET "shared" = false WHERE "source_id" IS NOT NULL;
