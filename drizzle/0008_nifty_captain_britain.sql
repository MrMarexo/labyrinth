-- One waiting match per creator: keep the newest, abandon the rest, so the
-- unique index below can be built. No real players exist yet.
UPDATE "match" SET "status" = 'abandoned', "end_reason" = 'abandoned', "winner_id" = NULL, "ended_at" = now(), "last_activity_at" = now()
WHERE "status" = 'awaiting_opponent' AND "id" NOT IN (
	SELECT DISTINCT ON ("created_by_id") "id" FROM "match" WHERE "status" = 'awaiting_opponent' ORDER BY "created_by_id", "created_at" DESC, "id" DESC
);--> statement-breakpoint
CREATE TABLE "match_request" (
	"match_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"declined_at" timestamp,
	CONSTRAINT "match_request_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "access" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_request" ADD CONSTRAINT "match_request_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_request" ADD CONSTRAINT "match_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_request_user_idx" ON "match_request" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_one_waiting_per_creator" ON "match" USING btree ("created_by_id") WHERE "match"."status" = 'awaiting_opponent';