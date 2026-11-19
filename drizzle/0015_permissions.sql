CREATE TABLE "filter_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filter_id" uuid NOT NULL,
	"project_id" uuid,
	"group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filter_shares_filter_project_unique" UNIQUE NULLS NOT DISTINCT("filter_id","project_id"),
	CONSTRAINT "filter_shares_filter_group_unique" UNIQUE NULLS NOT DISTINCT("filter_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"scheme_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"holder_type" text NOT NULL,
	"holder_parameter" text,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_grants_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "permission_schemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_schemes_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "project_role_actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"role_id" text NOT NULL,
	"role_name" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_parameter" text NOT NULL,
	"actor_display_name" text,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_role_actors_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
ALTER TABLE "user_groups" ADD COLUMN "source" text DEFAULT 'oidc' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_groups" DROP CONSTRAINT "user_groups_user_id_group_id_pk";--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_user_id_group_id_source_pk" PRIMARY KEY("user_id","group_id","source");--> statement-breakpoint
-- Memberships of a local group were all added by an administrator.
UPDATE "user_groups" SET "source" = 'local' WHERE "group_id" IN (SELECT "id" FROM "groups" WHERE "local");--> statement-breakpoint
ALTER TABLE "filter_shares" ADD CONSTRAINT "filter_shares_filter_id_filters_id_fk" FOREIGN KEY ("filter_id") REFERENCES "public"."filters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_shares" ADD CONSTRAINT "filter_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_shares" ADD CONSTRAINT "filter_shares_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_scheme_id_permission_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."permission_schemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_role_actors" ADD CONSTRAINT "project_role_actors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filter_shares_filter_idx" ON "filter_shares" USING btree ("filter_id");--> statement-breakpoint
CREATE INDEX "permission_grants_scheme_idx" ON "permission_grants" USING btree ("scheme_id");--> statement-breakpoint
CREATE INDEX "project_role_actors_project_idx" ON "project_role_actors" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_role_actors_role_idx" ON "project_role_actors" USING btree ("project_id","role_id");