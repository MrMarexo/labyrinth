CREATE TABLE "match" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"cell_count" integer NOT NULL,
	"gate_count" integer NOT NULL,
	"status" text DEFAULT 'awaiting_opponent' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"deadline_at" timestamp NOT NULL,
	"winner_id" text,
	"end_reason" text,
	CONSTRAINT "match_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "match_player" (
	"match_id" text NOT NULL,
	"user_id" text NOT NULL,
	"maze_id" text,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"forfeited_at" timestamp,
	CONSTRAINT "match_player_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_winner_id_user_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_player" ADD CONSTRAINT "match_player_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_player" ADD CONSTRAINT "match_player_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_player" ADD CONSTRAINT "match_player_maze_id_maze_id_fk" FOREIGN KEY ("maze_id") REFERENCES "public"."maze"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_sweep_idx" ON "match" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX "match_player_user_idx" ON "match_player" USING btree ("user_id");