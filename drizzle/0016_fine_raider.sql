CREATE TABLE "permission_local_assignments" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"scheme_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_local_removals" (
	"source_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permission_local_assignments" ADD CONSTRAINT "permission_local_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_local_assignments" ADD CONSTRAINT "permission_local_assignments_scheme_id_permission_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."permission_schemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permission_local_assignments_scheme_idx" ON "permission_local_assignments" USING btree ("scheme_id");