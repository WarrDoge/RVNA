ALTER TABLE "comments" ADD COLUMN "locally_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_links" ADD COLUMN "locally_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "locally_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "worklogs" ADD COLUMN "locally_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "page_comments" ADD COLUMN "locally_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "locally_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "locally_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE OR REPLACE FUNCTION rvna_mark_local_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.locally_changed_at = 'epoch'::timestamptz THEN
		NEW.locally_changed_at := NULL;
		RETURN NEW;
	END IF;
	IF current_setting('rvna.importer', true) = 'on' THEN
		RETURN NEW;
	END IF;
	-- wiki:convert rewrites body_doc only; that is maintenance, not a user edit.
	IF TG_TABLE_NAME IN ('pages', 'page_versions')
	   AND (to_jsonb(NEW) - 'body_doc' - 'locally_changed_at' - 'search')
	       = (to_jsonb(OLD) - 'body_doc' - 'locally_changed_at' - 'search') THEN
		RETURN NEW;
	END IF;
	-- A comment, a file or a worklog bumps updated on its issue. That is no change of the issue itself.
	IF TG_TABLE_NAME = 'issues'
	   AND (to_jsonb(NEW) - 'updated' - 'updated_at' - 'locally_changed_at' - 'search')
	       = (to_jsonb(OLD) - 'updated' - 'updated_at' - 'locally_changed_at' - 'search') THEN
		RETURN NEW;
	END IF;
	IF NEW.locally_changed_at IS NOT DISTINCT FROM OLD.locally_changed_at THEN
		NEW.locally_changed_at := now();
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION rvna_mark_issue_local_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF current_setting('rvna.importer', true) = 'on' THEN
		RETURN NULL;
	END IF;
	-- Local rows survive on their own. Only a removed imported child would come
	-- back on the next import, so that is the change that protects its issue.
	IF TG_OP = 'DELETE'
	   AND OLD.source_id IS NOT NULL
	   AND OLD.source_id NOT LIKE 'local:%'
	   AND OLD.source_id NOT LIKE 'fat:%' THEN
		UPDATE issues SET locally_changed_at = now()
		WHERE id = OLD.issue_id AND locally_changed_at IS NULL;
	END IF;
	IF TG_OP = 'UPDATE'
	   AND NEW.source_id IS NOT NULL
	   AND NEW.source_id NOT LIKE 'local:%'
	   AND NEW.source_id NOT LIKE 'fat:%' THEN
		UPDATE issues SET locally_changed_at = now()
		WHERE id = NEW.issue_id AND locally_changed_at IS NULL;
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION rvna_mark_page_local_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF current_setting('rvna.importer', true) = 'on' THEN
		RETURN NULL;
	END IF;
	IF TG_OP = 'DELETE' THEN
		UPDATE pages SET locally_changed_at = now()
		WHERE id = OLD.page_id AND locally_changed_at IS NULL;
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF (to_jsonb(NEW) - 'body_doc' - 'locally_changed_at' - 'search')
		   = (to_jsonb(OLD) - 'body_doc' - 'locally_changed_at' - 'search') THEN
			RETURN NULL;
		END IF;
		UPDATE pages SET locally_changed_at = now()
		WHERE id = NEW.page_id AND locally_changed_at IS NULL;
	END IF;
	IF TG_OP = 'INSERT'
	   AND NEW.source_id IS NOT NULL
	   AND (NEW.source_id LIKE 'fat:%' OR NEW.source_id LIKE 'local:%') THEN
		UPDATE pages SET locally_changed_at = now()
		WHERE id = NEW.page_id AND locally_changed_at IS NULL;
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER pages_mark_local_change BEFORE UPDATE ON pages
FOR EACH ROW EXECUTE FUNCTION rvna_mark_local_change();--> statement-breakpoint
CREATE TRIGGER issues_mark_local_change BEFORE UPDATE ON issues
FOR EACH ROW EXECUTE FUNCTION rvna_mark_local_change();--> statement-breakpoint
CREATE TRIGGER comments_mark_local_change BEFORE UPDATE ON comments
FOR EACH ROW EXECUTE FUNCTION rvna_mark_local_change();--> statement-breakpoint
CREATE TRIGGER worklogs_mark_local_change BEFORE UPDATE ON worklogs
FOR EACH ROW EXECUTE FUNCTION rvna_mark_local_change();--> statement-breakpoint
CREATE TRIGGER issue_links_mark_local_change BEFORE UPDATE ON issue_links
FOR EACH ROW EXECUTE FUNCTION rvna_mark_local_change();--> statement-breakpoint
CREATE TRIGGER page_versions_mark_local_change BEFORE UPDATE ON page_versions
FOR EACH ROW EXECUTE FUNCTION rvna_mark_local_change();--> statement-breakpoint
CREATE TRIGGER page_comments_mark_local_change BEFORE UPDATE ON page_comments
FOR EACH ROW EXECUTE FUNCTION rvna_mark_local_change();--> statement-breakpoint
CREATE TRIGGER comments_mark_issue_local_change AFTER INSERT OR UPDATE OR DELETE ON comments
FOR EACH ROW EXECUTE FUNCTION rvna_mark_issue_local_change();--> statement-breakpoint
CREATE TRIGGER worklogs_mark_issue_local_change AFTER INSERT OR UPDATE OR DELETE ON worklogs
FOR EACH ROW EXECUTE FUNCTION rvna_mark_issue_local_change();--> statement-breakpoint
CREATE OR REPLACE FUNCTION rvna_mark_issue_link_local_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF current_setting('rvna.importer', true) = 'on' THEN
		RETURN NULL;
	END IF;
	IF TG_OP = 'DELETE'
	   AND OLD.source_id IS NOT NULL
	   AND OLD.source_id NOT LIKE 'local:%'
	   AND OLD.source_id NOT LIKE 'fat:%' THEN
		UPDATE issues SET locally_changed_at = now()
		WHERE id IN (OLD.source_issue_id, OLD.target_issue_id)
		  AND locally_changed_at IS NULL;
	END IF;
	IF TG_OP = 'UPDATE'
	   AND NEW.source_id IS NOT NULL
	   AND NEW.source_id NOT LIKE 'local:%'
	   AND NEW.source_id NOT LIKE 'fat:%' THEN
		UPDATE issues SET locally_changed_at = now()
		WHERE id IN (NEW.source_issue_id, NEW.target_issue_id)
		  AND locally_changed_at IS NULL;
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER issue_links_mark_issue_local_change AFTER INSERT OR UPDATE OR DELETE ON issue_links
FOR EACH ROW EXECUTE FUNCTION rvna_mark_issue_link_local_change();--> statement-breakpoint
CREATE TRIGGER issue_labels_mark_issue_local_change AFTER INSERT OR UPDATE OR DELETE ON issue_labels
FOR EACH ROW EXECUTE FUNCTION rvna_mark_issue_local_change();--> statement-breakpoint
CREATE TRIGGER issue_components_mark_issue_local_change AFTER INSERT OR UPDATE OR DELETE ON issue_components
FOR EACH ROW EXECUTE FUNCTION rvna_mark_issue_local_change();--> statement-breakpoint
CREATE TRIGGER issue_fix_versions_mark_issue_local_change AFTER INSERT OR UPDATE OR DELETE ON issue_fix_versions
FOR EACH ROW EXECUTE FUNCTION rvna_mark_issue_local_change();--> statement-breakpoint
CREATE TRIGGER issue_affects_versions_mark_issue_local_change AFTER INSERT OR UPDATE OR DELETE ON issue_affects_versions
FOR EACH ROW EXECUTE FUNCTION rvna_mark_issue_local_change();--> statement-breakpoint
CREATE TRIGGER watchers_mark_issue_local_change AFTER INSERT OR UPDATE OR DELETE ON watchers
FOR EACH ROW EXECUTE FUNCTION rvna_mark_issue_local_change();--> statement-breakpoint
CREATE TRIGGER attachments_mark_issue_local_change AFTER INSERT OR UPDATE OR DELETE ON attachments
FOR EACH ROW EXECUTE FUNCTION rvna_mark_issue_local_change();--> statement-breakpoint
CREATE TRIGGER page_versions_mark_page_local_change AFTER INSERT OR UPDATE OR DELETE ON page_versions
FOR EACH ROW EXECUTE FUNCTION rvna_mark_page_local_change();--> statement-breakpoint
CREATE TRIGGER page_labels_mark_page_local_change AFTER INSERT OR UPDATE OR DELETE ON page_labels
FOR EACH ROW EXECUTE FUNCTION rvna_mark_page_local_change();--> statement-breakpoint
CREATE TRIGGER page_restrictions_mark_page_local_change AFTER INSERT OR UPDATE OR DELETE ON page_restrictions
FOR EACH ROW EXECUTE FUNCTION rvna_mark_page_local_change();
