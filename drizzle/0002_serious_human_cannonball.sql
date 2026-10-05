CREATE TABLE "maze" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"name" text NOT NULL,
	"cell_count" integer NOT NULL,
	"gate_count" integer NOT NULL,
	"data" jsonb NOT NULL,
	"content_hash" text,
	"optimal_moves" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maze" ADD CONSTRAINT "maze_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maze_author_updated_idx" ON "maze" USING btree ("author_id","updated_at");