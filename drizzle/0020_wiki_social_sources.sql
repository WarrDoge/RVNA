ALTER TABLE "page_likes" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "page_watchers" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "space_watchers" ADD COLUMN "source_id" text;