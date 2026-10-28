import { and, eq, inArray, lte, notExists } from "drizzle-orm";

import type { db as Database } from "~/server/db";
import { matchPlayer, user } from "~/server/db/schema";

// One statement per batch, like the match mazes' purge.
const PURGE_BATCH_LIMIT = 100;

// How long a guest who never took a seat is kept. It shares its number with
// the replay window by coincidence, not by rule, so it has its own constant.
const IDLE_GUEST_DAYS = 30;

/**
 * Removes guests who were created `IDLE_GUEST_DAYS` ago or more and never
 * took a seat in a match. A guest with a seat is never removed here.
 */
export async function purgeIdleGuests(
  db: typeof Database,
  now: Date,
): Promise<{ purged: number; capped: boolean }> {
  const cutoff = new Date(
    now.getTime() - IDLE_GUEST_DAYS * 24 * 60 * 60 * 1000,
  );

  const due = db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.isAnonymous, true),
        lte(user.createdAt, cutoff),
        notExists(
          db
            .select({ one: matchPlayer.userId })
            .from(matchPlayer)
            .where(eq(matchPlayer.userId, user.id)),
        ),
      ),
    )
    .limit(PURGE_BATCH_LIMIT);

  const purged = await db
    .delete(user)
    .where(inArray(user.id, due))
    .returning({ id: user.id });

  return {
    purged: purged.length,
    capped: purged.length === PURGE_BATCH_LIMIT,
  };
}
