ALTER TABLE "match_player" DROP CONSTRAINT "match_player_maze_id_maze_id_fk";
--> statement-breakpoint
ALTER TABLE "maze" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "match_player" ADD CONSTRAINT "match_player_maze_id_maze_id_fk" FOREIGN KEY ("maze_id") REFERENCES "public"."maze"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Matches already over when this shipped: every terminal write also sets
-- last_activity_at, so it is when they ended.
UPDATE "match" SET "ended_at" = "last_activity_at" WHERE "status" IN ('complete', 'abandoned') AND "ended_at" IS NULL;
