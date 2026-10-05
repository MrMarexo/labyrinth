import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Spec §6. `data` holds a DraftMaze while `status` is "draft" and a Maze once
 * submitted — the same column, because a draft becomes the maze rather than
 * being copied into one.
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
    status: text("status", { enum: ["draft", "submitted"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("maze_author_updated_idx").on(table.authorId, table.updatedAt),
  ],
);
