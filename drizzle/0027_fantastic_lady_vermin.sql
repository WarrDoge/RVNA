DELETE FROM "project_role_actors" a
USING "project_role_actors" b
WHERE a."project_id" = b."project_id"
	AND lower(a."role_id") = lower(b."role_id")
	AND a."actor_type" = b."actor_type"
	AND lower(a."actor_parameter") = lower(b."actor_parameter")
	AND (a."created_at", a."id") > (b."created_at", b."id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_role_actors_identity_unique" ON "project_role_actors" USING btree ("project_id",lower("role_id"),"actor_type",lower("actor_parameter"));