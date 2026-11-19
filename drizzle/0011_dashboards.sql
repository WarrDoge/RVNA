CREATE TABLE "dashboard_favourites" (
	"user_id" uuid NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_favourites_user_id_dashboard_id_pk" PRIMARY KEY("user_id","dashboard_id")
);
--> statement-breakpoint
CREATE TABLE "dashboard_gadgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text,
	"dashboard_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"column_index" integer DEFAULT 0 NOT NULL,
	"row_index" integer DEFAULT 0 NOT NULL,
	"color" text DEFAULT 'color1' NOT NULL,
	"refresh_seconds" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_gadgets_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text,
	"name" text NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"layout" text DEFAULT 'AA' NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboards_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
ALTER TABLE "filters" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "dashboard_favourites" ADD CONSTRAINT "dashboard_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_favourites" ADD CONSTRAINT "dashboard_favourites_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_gadgets" ADD CONSTRAINT "dashboard_gadgets_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboard_gadgets_dashboard_idx" ON "dashboard_gadgets" USING btree ("dashboard_id");--> statement-breakpoint
CREATE INDEX "dashboards_owner_idx" ON "dashboards" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "filters" ADD CONSTRAINT "filters_source_id_unique" UNIQUE("source_id");