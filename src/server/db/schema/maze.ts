import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Spec §6. A player's own labyrinth, theirs to edit or delete at any time:
 * a match plays its own copy (`matchMaze`), never this row. `data` is a
 * DraftMaze.
 *
 * `contentHash` and `optimalMoves` are null until the maze validates: they are
 * derived by the solver and a half-drawn maze has neither.
 */
export const maze = pgTable(
  "maze",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cellCount: integer("cell_count").notNull(),
    gateCount: integer("gate_count").notNull(),
    data: jsonb("data").notNull(),
    contentHash: text("content_hash"),
    optimalMoves: integer("optimal_moves"),
    /**
     * Bumped by every `saveDraft`, which only writes over the version the
     * editor loaded: a stale editor (another tab, a cached page) is refused
     * instead of silently overwriting newer squares.
     */
    version: integer("version").notNull().default(0),
    /**
     * The author's one labyrinth in progress. Autosaved while it is drawn,
     * but not in their library: it does not count toward the limit, and it
     * becomes a saved labyrinth only through `maze.saveConcept` or by being
     * used in a match.
     */
    concept: boolean("concept").notNull().default(false),
    /**
     * For a concept opened from a saved labyrinth: that labyrinth, which its
     * save writes back into. Null for a new one.
     */
    sourceId: text("source_id").references((): AnyPgColumn => maze.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("maze_author_updated_idx").on(table.authorId, table.updatedAt),
    uniqueIndex("maze_one_concept_per_author")
      .on(table.authorId)
      .where(sql`${table.concept}`),
  ],
);
