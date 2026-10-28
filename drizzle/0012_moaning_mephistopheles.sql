ALTER TABLE "match_player" DROP CONSTRAINT "match_player_maze_id_maze_id_fk";
--> statement-breakpoint
ALTER TABLE "maze" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "maze" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "match_player" DROP COLUMN "maze_id";