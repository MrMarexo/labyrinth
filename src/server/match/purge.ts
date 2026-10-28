import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";

import { REPLAY_RETENTION_DAYS } from "~/match";
import type { db as Database } from "~/server/db";
import { match, matchMaze } from "~/server/db/schema";

// One statement per batch, so a backlog drains over several nightly runs
// within the cron's time budget, like the match sweep's own batches.
const PURGE_BATCH_LIMIT = 100;

/**
 * Removes the matches' copies of their mazes once the replay window has
 * closed: the match ended at least `REPLAY_RETENTION_DAYS` ago. The scores
 * and the move log stay; only the drawings go.
 */
export async function purgeMatchMazes(
  db: typeof Database,
  now: Date,
): Promise<{ purged: number; capped: boolean }> {
  const cutoff = new Date(
    now.getTime() - REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const due = db
    .selectDistinct({ id: matchMaze.matchId })
    .from(matchMaze)
    .innerJoin(match, eq(match.id, matchMaze.matchId))
    .where(and(isNotNull(match.endedAt), lte(match.endedAt, cutoff)))
    .limit(PURGE_BATCH_LIMIT);

  const purged = await db
    .delete(matchMaze)
    .where(inArray(matchMaze.matchId, due))
    .returning({ matchId: matchMaze.matchId });

  const matches = new Set(purged.map((p) => p.matchId)).size;
  return { purged: matches, capped: matches === PURGE_BATCH_LIMIT };
}
