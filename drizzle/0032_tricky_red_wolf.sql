-- Rows that the old constraints allowed but the new unique indexes do not:
-- merge groups that differ only by case, rename duplicate usernames, and
-- renumber duplicate issue numbers above their project's maximum.
CREATE TEMP TABLE group_merge AS
WITH ranked AS (
	SELECT id,
	       lower(name) AS normalized,
	       row_number() OVER (PARTITION BY lower(name) ORDER BY local DESC, id) AS position
	FROM groups
)
SELECT duplicate.id AS duplicate_id, keeper.id AS keep_id
FROM ranked duplicate
JOIN ranked keeper ON keeper.normalized = duplicate.normalized AND keeper.position = 1
WHERE duplicate.position > 1;--> statement-breakpoint
INSERT INTO user_groups (user_id, group_id, source)
SELECT ug.user_id, gm.keep_id, ug.source
FROM user_groups ug
JOIN group_merge gm ON gm.duplicate_id = ug.group_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM user_groups ug
USING group_merge gm
WHERE ug.group_id = gm.duplicate_id;--> statement-breakpoint
UPDATE filter_shares fs
SET group_id = gm.keep_id
FROM group_merge gm
WHERE fs.group_id = gm.duplicate_id
  AND NOT EXISTS (
    SELECT 1 FROM filter_shares other
    WHERE other.filter_id = fs.filter_id AND other.group_id = gm.keep_id
  );--> statement-breakpoint
DELETE FROM filter_shares fs
USING group_merge gm
WHERE fs.group_id = gm.duplicate_id;--> statement-breakpoint
DELETE FROM groups g
USING group_merge gm
WHERE g.id = gm.duplicate_id;--> statement-breakpoint
DROP TABLE group_merge;--> statement-breakpoint
CREATE TEMP TABLE user_rename AS
WITH ranked AS (
	SELECT id, username,
	       row_number() OVER (PARTITION BY lower(username) ORDER BY created_at, id) AS position
	FROM users
)
SELECT id, username || '-duplicate-' || id::text AS new_username
FROM ranked
WHERE position > 1;--> statement-breakpoint
UPDATE users u
SET username = ur.new_username, updated_at = now()
FROM user_rename ur
WHERE u.id = ur.id;--> statement-breakpoint
DROP TABLE user_rename;--> statement-breakpoint
CREATE TEMP TABLE issue_renumber AS
WITH maxima AS (
	SELECT project_id, max(number) AS max_number
	FROM issues
	GROUP BY project_id
), duplicates AS (
	SELECT i.id, i.project_id, i.created_at,
	       p.key AS project_key,
	       row_number() OVER (
	         PARTITION BY i.project_id, i.number
	         ORDER BY (i.key = p.key || '-' || i.number) DESC, i.created_at, i.id
	       ) AS position
	FROM issues i
	JOIN projects p ON p.id = i.project_id
	WHERE (i.project_id, i.number) IN (
	  SELECT project_id, number FROM issues GROUP BY project_id, number HAVING count(*) > 1
	)
), renumbered AS (
	SELECT d.id, d.project_id,
	       (m.max_number + row_number() OVER (PARTITION BY d.project_id ORDER BY d.created_at, d.id))::integer AS new_number
	FROM duplicates d
	JOIN maxima m ON m.project_id = d.project_id
	WHERE d.position > 1
)
SELECT r.id, r.project_id, r.new_number, p.key || '-' || r.new_number AS new_key
FROM renumbered r
JOIN projects p ON p.id = r.project_id;--> statement-breakpoint
UPDATE issues i
SET number = ir.new_number, key = ir.new_key, updated_at = now()
FROM issue_renumber ir
WHERE i.id = ir.id;--> statement-breakpoint
UPDATE projects p
SET last_issue_number = greatest(p.last_issue_number, m.max_number)
FROM (
	SELECT project_id, max(number) AS max_number FROM issues GROUP BY project_id
) m
WHERE p.id = m.project_id AND p.last_issue_number < m.max_number;--> statement-breakpoint
DROP TABLE issue_renumber;--> statement-breakpoint
ALTER TABLE "gitlab_pipelines" DROP CONSTRAINT "gitlab_pipelines_repository_id_unique";--> statement-breakpoint
ALTER TABLE "gitlab_automation_events" DROP CONSTRAINT "gitlab_automation_events_issue_id_issues_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "projects_key_idx";--> statement-breakpoint
ALTER TABLE "page_attachments" ALTER COLUMN "size" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "gitlab_automation_events" ADD CONSTRAINT "gitlab_automation_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_lower_unique" ON "groups" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_unique" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "audit_log_entity_type_idx" ON "audit_log" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "dashboard_favourites_dashboard_idx" ON "dashboard_favourites" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "gitlab_project_repositories_repository_idx" ON "gitlab_project_repositories" USING btree ("repository_id");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_number_unique" UNIQUE("project_id","number");--> statement-breakpoint
ALTER TABLE "gitlab_pipelines" ADD CONSTRAINT "gitlab_pipelines_repository_gitlab_id_unique" UNIQUE("repository_id","gitlab_id");--> statement-breakpoint
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_wip_non_negative" CHECK (("board_columns"."min_issues" is null or "board_columns"."min_issues" >= 0) and ("board_columns"."max_issues" is null or "board_columns"."max_issues" >= 0)) NOT VALID;--> statement-breakpoint
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_wip_order" CHECK ("board_columns"."min_issues" is null or "board_columns"."max_issues" is null or "board_columns"."min_issues" <= "board_columns"."max_issues") NOT VALID;