import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { END_REASONS, MATCH_STATUSES } from "~/match";
import {
  DIRECTIONS,
  SERVER_OUTCOMES,
  type RunnerDelta,
  type StoredRun,
} from "~/maze";

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
    /**
     * When the match became terminal; null while it is open. Stored despite
     * §6's stance on derivable values: a match the sweep closes has no player
     * timestamp to derive it from. Replays and deleted mazes are kept for a
     * window measured from here.
     */
    endedAt: timestamp("ended_at"),
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
 * Spec §6. `mazeId` is null until that player submits.
 *
 * The run columns are Phase 4's. There is no `runStatus`: not started,
 * running, finished and gave up are `startedAt`, `finishedAt` and `gaveUpAt`
 * being null or not, and a stored copy would be a second source of truth.
 * Penalties and the move count live inside `runState`, beside the position
 * they belong with. `runState` is a cache of the move log (AGENTS.md
 * invariant 4) and is written in the same transaction as each move.
 *
 * `gaveUpAt` is not `forfeitedAt`: the sweep sets `forfeitedAt` on a player
 * who ran out of time, and the result screen has to tell the two apart.
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
    // Null until that player submits, and again once the purge removes a
    // deleted maze whose replay window has closed. "Has submitted" is
    // `submittedAt`, never `mazeId`.
    mazeId: text("maze_id").references(() => maze.id, {
      onDelete: "set null",
    }),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
    submittedAt: timestamp("submitted_at"),
    forfeitedAt: timestamp("forfeited_at"),
    runState: jsonb("run_state").$type<StoredRun>(),
    startedAt: timestamp("started_at"),
    lastMoveAt: timestamp("last_move_at"),
    finishedAt: timestamp("finished_at"),
    gaveUpAt: timestamp("gave_up_at"),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.userId] }),
    index("match_player_user_idx").on(table.userId),
    // A run ends one way. Giving up after the treasure is refused by
    // `run.giveUp`; this is what makes that refusal more than a convention.
    check(
      "match_player_finished_or_gave_up",
      sql`${table.finishedAt} IS NULL OR ${table.gaveUpAt} IS NULL`,
    ),
  ],
);

/**
 * Spec §6 and §7. The move log is the source of truth (AGENTS.md invariant
 * 4); `match_player.runState` is its cache.
 *
 * `outcome` is the server's, and so may be `blocked_boundary`. `delta` is
 * exactly what the runner was sent — `blocked_boundary` already collapsed to
 * `blocked_wall` — because it is what a retried request must get back
 * (§7.2) and what replay will read (§8). Storing the runner's delta rather
 * than re-deriving it means a retry can never disclose more than the
 * original answer did.
 */
export const move = pgTable(
  "move",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    matchId: text("match_id")
      .notNull()
      .references(() => match.id, { onDelete: "cascade" }),
    runnerId: text("runner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    dir: text("dir", { enum: DIRECTIONS }).notNull(),
    outcome: text("outcome", { enum: SERVER_OUTCOMES }).notNull(),
    delta: jsonb("delta").$type<RunnerDelta>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // §7.2. Also the index every per-runner read of the log uses.
    unique("move_runner_seq_unique").on(
      table.matchId,
      table.runnerId,
      table.seq,
    ),
  ],
);
