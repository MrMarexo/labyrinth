import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { END_REASONS, MATCH_STATUSES } from "~/match";

import { user } from "./auth";
import { maze } from "./maze";

/**
 * Spec §6. `deadlineAt` is recomputed on every phase transition rather than
 * being six rules scattered through the code, so the sweep is one indexed
 * query. `winnerId` is null for everything except `finished` and `forfeit`,
 * which is how "you cannot win without finding the treasure" is enforced at
 * the schema level.
 *
 * `bothJoinedAt` and `unlockedAt` are deliberately absent: both are derivable
 * from `match_player` (the later of the two `joinedAt`s, and the later of the
 * two `submittedAt`s), and a denormalised copy of a derivable timestamp is a
 * second source of truth waiting to disagree with the first.
 *
 * The `match_winner_requires_win` check is the actual enforcement of that
 * rule: until Phase 4 adds its first non-sweep writer of `winnerId`, the
 * rule only held because `sweepExpiredMatches` happened to be the one
 * writer and happened to be correct.
 */
export const match = pgTable(
  "match",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    code: text("code").notNull().unique(),
    cellCount: integer("cell_count").notNull(),
    gateCount: integer("gate_count").notNull(),
    status: text("status", { enum: MATCH_STATUSES })
      .notNull()
      .default("awaiting_opponent"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at").notNull(),
    winnerId: text("winner_id").references(() => user.id, {
      onDelete: "set null",
    }),
    endReason: text("end_reason", { enum: END_REASONS }),
  },
  (table) => [
    // The sweep's only query: open matches whose deadline has passed.
    index("match_sweep_idx").on(table.status, table.deadlineAt),
    // You cannot win without finding the treasure: a winner is only legal
    // on a match that actually ended in a win, not one the sweep merely
    // gave up on.
    check(
      "match_winner_requires_win",
      sql`${table.winnerId} IS NULL OR ${table.endReason} IN ('finished', 'forfeit')`,
    ),
  ],
);

/**
 * Spec §6. `mazeId` is null until that player submits. The run columns
 * (`runStatus`, `penalties`, `moveCount`, `runState`, `startedAt`,
 * `lastMoveAt`, `finishedAt`) are Phase 4's and are deliberately not created
 * here — nothing reads or writes them yet.
 */
export const matchPlayer = pgTable(
  "match_player",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => match.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mazeId: text("maze_id").references(() => maze.id, {
      onDelete: "restrict",
    }),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
    submittedAt: timestamp("submitted_at"),
    forfeitedAt: timestamp("forfeited_at"),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.userId] }),
    index("match_player_user_idx").on(table.userId),
  ],
);
