UPDATE "pages" AS p SET "locally_changed_at" = v."changed"
FROM (
	SELECT "page_id", coalesce(max("created"), now()) AS "changed"
	FROM "page_versions"
	WHERE "source_id" LIKE 'fat:%'
	GROUP BY "page_id"
) AS v
WHERE p."id" = v."page_id" AND p."locally_changed_at" IS NULL;--> statement-breakpoint
UPDATE "issues" AS i SET "locally_changed_at" = v."changed"
FROM (
	SELECT "issue_id", coalesce(max("created"), now()) AS "changed"
	FROM "issue_history"
	WHERE "source_id" LIKE 'local:%'
	GROUP BY "issue_id"
) AS v
WHERE i."id" = v."issue_id" AND i."locally_changed_at" IS NULL;
