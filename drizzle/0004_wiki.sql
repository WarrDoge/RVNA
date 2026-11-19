CREATE TABLE "page_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text,
	"size" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"author_id" uuid,
	"created" timestamp with time zone,
	"comment" text,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_attachments_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "page_attachments_page_file_version_unique" UNIQUE("page_id","file_name","version")
);
--> statement-breakpoint
CREATE TABLE "page_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" uuid,
	"body_html" text,
	"body_storage" text,
	"created" timestamp with time zone,
	"updated" timestamp with time zone,
	"inline" boolean DEFAULT false NOT NULL,
	"inline_original_selection" text,
	"inline_marker_ref" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_comments_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "page_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_labels_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "page_labels_page_label_unique" UNIQUE("page_id","label")
);
--> statement-breakpoint
CREATE TABLE "page_restrictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"user_id" uuid,
	"group_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_restrictions_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "page_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"space_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"body_storage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_templates_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text,
	"body_storage" text,
	"body_html" text,
	"author_id" uuid,
	"created" timestamp with time zone,
	"message" text,
	"minor_edit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_versions_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "page_versions_page_number_unique" UNIQUE("page_id","number")
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'page' NOT NULL,
	"status" text DEFAULT 'current' NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"body_storage" text,
	"body_html" text,
	"body_doc" jsonb,
	"creator_id" uuid,
	"created" timestamp with time zone,
	"last_modifier_id" uuid,
	"updated" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("body_html", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "space_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"space_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"user_id" uuid,
	"group_name" text,
	"anonymous" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_permissions_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'global' NOT NULL,
	"description_html" text,
	"home_page_id" uuid,
	"owner_id" uuid,
	"status" text DEFAULT 'current' NOT NULL,
	"icon_path" text,
	"created" timestamp with time zone,
	"creator_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "spaces_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "page_attachments" ADD CONSTRAINT "page_attachments_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_attachments" ADD CONSTRAINT "page_attachments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_parent_id_page_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."page_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_labels" ADD CONSTRAINT "page_labels_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_id_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_last_modifier_id_users_id_fk" FOREIGN KEY ("last_modifier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_home_page_id_pages_id_fk" FOREIGN KEY ("home_page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_attachments_page_idx" ON "page_attachments" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_comments_page_idx" ON "page_comments" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_comments_parent_idx" ON "page_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "page_labels_label_idx" ON "page_labels" USING btree ("label");--> statement-breakpoint
CREATE INDEX "page_restrictions_page_idx" ON "page_restrictions" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_templates_space_idx" ON "page_templates" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "page_versions_page_idx" ON "page_versions" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "pages_space_idx" ON "pages" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "pages_parent_idx" ON "pages" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "pages_space_parent_position_idx" ON "pages" USING btree ("space_id","parent_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_space_title_current_unique" ON "pages" USING btree ("space_id","title") WHERE status = 'current';--> statement-breakpoint
CREATE INDEX "pages_search_gin" ON "pages" USING gin ("search");--> statement-breakpoint
CREATE INDEX "pages_title_trgm_gin" ON "pages" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "space_permissions_space_idx" ON "space_permissions" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "spaces_owner_idx" ON "spaces" USING btree ("owner_id");