-- Schemes built in the app keep the rights they had before MODIFY_REPORTER and SCHEDULE_ISSUES
-- were enforced: copy each local scheme's EDIT_ISSUES holders once for each of the two keys
-- the scheme lacks. Imported schemes get their real grants from the next Jira permissions import.
INSERT INTO "permission_grants" ("source_id", "scheme_id", "permission_key", "holder_type", "holder_parameter", "raw")
SELECT
	'local:' || gen_random_uuid()::text,
	g."scheme_id",
	k."permission_key",
	g."holder_type",
	g."holder_parameter",
	jsonb_build_object('migration', k."permission_key", 'copiedFrom', g."source_id")
FROM "permission_grants" g
JOIN "permission_schemes" s ON s."id" = g."scheme_id"
CROSS JOIN (VALUES ('MODIFY_REPORTER'), ('SCHEDULE_ISSUES')) AS k("permission_key")
WHERE g."permission_key" = 'EDIT_ISSUES'
	AND s."source_id" LIKE 'local:%'
	AND NOT EXISTS (
		SELECT 1 FROM "permission_grants" m
		WHERE m."scheme_id" = g."scheme_id" AND m."permission_key" = k."permission_key"
	);
