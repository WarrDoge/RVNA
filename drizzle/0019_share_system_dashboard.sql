-- Migration 0018 made every imported dashboard private; the System Dashboard (Jira id 10000) is what every user lands on.
UPDATE "dashboards" SET "shared" = true WHERE "source_id" = '10000';
