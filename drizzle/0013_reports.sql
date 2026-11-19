CREATE TABLE "board_sprints" (
	"board_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_sprints_board_id_sprint_id_pk" PRIMARY KEY("board_id","sprint_id")
);
--> statement-breakpoint
CREATE TABLE "sprint_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sprint_id" uuid NOT NULL,
	"rapid_view_id" integer NOT NULL,
	"contents" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_reports_sprint_id_unique" UNIQUE("sprint_id")
);
--> statement-breakpoint
ALTER TABLE "board_sprints" ADD CONSTRAINT "board_sprints_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_sprints" ADD CONSTRAINT "board_sprints_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_reports" ADD CONSTRAINT "sprint_reports_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_sprints_sprint_idx" ON "board_sprints" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "sprint_reports_sprint_idx" ON "sprint_reports" USING btree ("sprint_id");