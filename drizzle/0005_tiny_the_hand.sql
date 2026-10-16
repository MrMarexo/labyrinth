CREATE TABLE "move" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"runner_id" text NOT NULL,
	"seq" integer NOT NULL,
	"dir" text NOT NULL,
	"outcome" text NOT NULL,
	"delta" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "move_runner_seq_unique" UNIQUE("match_id","runner_id","seq")
);
--> statement-breakpoint
ALTER TABLE "match_player" ADD COLUMN "run_state" jsonb;--> statement-breakpoint
ALTER TABLE "match_player" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "match_player" ADD COLUMN "last_move_at" timestamp;--> statement-breakpoint
ALTER TABLE "match_player" ADD COLUMN "finished_at" timestamp;--> statement-breakpoint
ALTER TABLE "match_player" ADD COLUMN "gave_up_at" timestamp;--> statement-breakpoint
ALTER TABLE "move" ADD CONSTRAINT "move_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move" ADD CONSTRAINT "move_runner_id_user_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_player" ADD CONSTRAINT "match_player_finished_or_gave_up" CHECK ("match_player"."finished_at" IS NULL OR "match_player"."gave_up_at" IS NULL);