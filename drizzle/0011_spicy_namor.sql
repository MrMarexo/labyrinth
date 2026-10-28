CREATE TABLE "match_maze" (
	"match_id" text NOT NULL,
	"user_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "match_maze_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "match_player" ADD COLUMN "maze_hash" text;--> statement-breakpoint
ALTER TABLE "match_maze" ADD CONSTRAINT "match_maze_match_id_user_id_match_player_match_id_user_id_fk" FOREIGN KEY ("match_id","user_id") REFERENCES "public"."match_player"("match_id","user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
-- Every submitted maze becomes its match's own copy; the nightly purge then
-- drops the copies of matches whose replay window has closed.
INSERT INTO "match_maze" ("match_id", "user_id", "data", "created_at")
SELECT mp."match_id", mp."user_id", m."data", COALESCE(mp."submitted_at", now())
FROM "match_player" mp
JOIN "maze" m ON m."id" = mp."maze_id";--> statement-breakpoint
UPDATE "match_player" mp SET "maze_hash" = m."content_hash"
FROM "maze" m WHERE m."id" = mp."maze_id";--> statement-breakpoint
-- A concept opened as a copy of a used labyrinth ("Edit of …") was never
-- going to save into it; keep it that way now that every labyrinth can be.
UPDATE "maze" SET "source_id" = NULL
WHERE "concept" AND "source_id" IN (SELECT "id" FROM "maze" WHERE "status" = 'submitted');--> statement-breakpoint
-- Labyrinths their authors deleted were only hidden for the matches that
-- used them, which now have their own copies. A guest's were hidden only
-- because a guest has no library; they stay, for an account to inherit.
DELETE FROM "maze" USING "user" u
WHERE u."id" = "maze"."author_id" AND "maze"."deleted_at" IS NOT NULL AND NOT u."is_anonymous";
