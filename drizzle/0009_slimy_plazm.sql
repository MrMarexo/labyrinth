ALTER TABLE "maze" ADD COLUMN "concept" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "maze" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "maze" ADD CONSTRAINT "maze_source_id_maze_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."maze"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maze_one_concept_per_author" ON "maze" USING btree ("author_id") WHERE "maze"."concept";--> statement-breakpoint
-- Empty drafts left behind by opening the editor and leaving: nothing in
-- them is worth keeping, and as saved labyrinths they would count toward
-- the limit with nothing left to discard them.
DELETE FROM "maze"
WHERE "status" = 'draft' AND "content_hash" IS NULL AND "deleted_at" IS NULL
	AND jsonb_array_length("data" -> 'cells') = 0;--> statement-breakpoint
-- Each author's newest unfinished draft becomes their concept, so work in
-- progress carries over. Older unfinished drafts stay saved labyrinths.
UPDATE "maze" SET "concept" = true WHERE "id" IN (
	SELECT DISTINCT ON ("author_id") "id" FROM "maze"
	WHERE "status" = 'draft' AND "content_hash" IS NULL AND "deleted_at" IS NULL
	ORDER BY "author_id", "updated_at" DESC, "id" DESC
);
