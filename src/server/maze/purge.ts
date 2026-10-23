import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  gt,
} from "drizzle-orm";

import { REPLAY_RETENTION_DAYS } from "~/match";
import type { db as Database } from "~/server/db";
import { match, matchPlayer, maze } from "~/server/db/schema";

// One statement per batch, so a backlog drains over several nightly runs
// within the cron's time budget, like the match sweep's own batches.
const PURGE_BATCH_LIMIT = 100;

/**
 * Removes for good the mazes their authors deleted that no match can show
 * any more: every match that used one is over, and ended at least
 * `REPLAY_RETENTION_DAYS` ago. A maze still in an open match, or in one
 * inside its replay window, waits. The foreign key nulls the matches' links.
 */
export async function purgeDeletedMazes(
  db: typeof Database,
  now: Date,
): Promise<{ purged: number; capped: boolean }> {
  const cutoff = new Date(
    now.getTime() - REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const stillShown = db
    .select({ id: matchPlayer.mazeId })
    .from(matchPlayer)
    .innerJoin(match, eq(match.id, matchPlayer.matchId))
    .where(
      and(
        eq(matchPlayer.mazeId, maze.id),
        or(isNull(match.endedAt), gt(match.endedAt, cutoff)),
      ),
    );

  const due = db
    .select({ id: maze.id })
    .from(maze)
    .where(and(isNotNull(maze.deletedAt), notExists(stillShown)))
    .limit(PURGE_BATCH_LIMIT);

  const purged = await db
    .delete(maze)
    .where(inArray(maze.id, due))
    .returning({ id: maze.id });

  return {
    purged: purged.length,
    capped: purged.length === PURGE_BATCH_LIMIT,
  };
}
