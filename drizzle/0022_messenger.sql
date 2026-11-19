CREATE TABLE "messenger_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"homeserver_url" text DEFAULT '' NOT NULL,
	"access_token" text,
	"service_desk_id" uuid,
	"request_type_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"since_token" text,
	"bot_matrix_id" text,
	"server_name" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messenger_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messenger_link_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "messenger_processed_events" (
	"room_id" text NOT NULL,
	"event_id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messenger_processed_events_room_id_event_id_pk" PRIMARY KEY("room_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "messenger_rooms" (
	"room_id" text PRIMARY KEY NOT NULL,
	"encrypted" boolean DEFAULT false NOT NULL,
	"encryption_notice_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messenger_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"root_event_id" text NOT NULL,
	"attachment_notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messenger_threads_issue_id_unique" UNIQUE("issue_id"),
	CONSTRAINT "messenger_threads_room_root_unique" UNIQUE("room_id","root_event_id")
);
--> statement-breakpoint
CREATE TABLE "messenger_unknown_senders" (
	"matrix_id" text PRIMARY KEY NOT NULL,
	"last_notice_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "messenger_matrix_id" text;--> statement-breakpoint
ALTER TABLE "messenger_link_codes" ADD CONSTRAINT "messenger_link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_threads" ADD CONSTRAINT "messenger_threads_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messenger_link_codes_user_idx" ON "messenger_link_codes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_messenger_matrix_id_unique" UNIQUE("messenger_matrix_id");