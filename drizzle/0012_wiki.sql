CREATE TABLE "page_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page_id" uuid,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"body_doc" jsonb,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_locks" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_over_from" uuid,
	"taken_over_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "page_trash" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"trashed_by" uuid,
	"trashed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"original_parent_id" uuid,
	"original_position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_likes_page_user_unique" UNIQUE("page_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "page_watchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_watchers_page_user_unique" UNIQUE("page_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "space_watchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_watchers_space_user_unique" UNIQUE("space_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "body_doc" jsonb;--> statement-breakpoint
ALTER TABLE "page_drafts" ADD CONSTRAINT "page_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_drafts" ADD CONSTRAINT "page_drafts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_drafts" ADD CONSTRAINT "page_drafts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_drafts" ADD CONSTRAINT "page_drafts_parent_id_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_locks" ADD CONSTRAINT "page_locks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_locks" ADD CONSTRAINT "page_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_locks" ADD CONSTRAINT "page_locks_taken_over_from_users_id_fk" FOREIGN KEY ("taken_over_from") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_trash" ADD CONSTRAINT "page_trash_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_trash" ADD CONSTRAINT "page_trash_trashed_by_users_id_fk" FOREIGN KEY ("trashed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_trash" ADD CONSTRAINT "page_trash_original_parent_id_pages_id_fk" FOREIGN KEY ("original_parent_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_likes" ADD CONSTRAINT "page_likes_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_likes" ADD CONSTRAINT "page_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_watchers" ADD CONSTRAINT "page_watchers_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_watchers" ADD CONSTRAINT "page_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_watchers" ADD CONSTRAINT "space_watchers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_watchers" ADD CONSTRAINT "space_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_drafts_user_page_unique" ON "page_drafts" USING btree ("user_id","page_id") WHERE page_id is not null;--> statement-breakpoint
CREATE INDEX "page_drafts_user_idx" ON "page_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "page_likes_page_idx" ON "page_likes" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_watchers_user_idx" ON "page_watchers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "space_watchers_user_idx" ON "space_watchers" USING btree ("user_id");