import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { OPEN_STATUSES, resolveExpiry } from "~/match";
import type { db as Database } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";
// `situationFor` lives in its own module, not in the router: a server-side
// domain helper should not have to be reached through a tRPC router, and the
// sweep is its second consumer.
import { situationFor } from "~/server/match/situation";
import { publishMatchChanged } from "~/server/realtime/events";

// `resolveExpiry` already no-ops on a terminal status (`deadlineFor` returns
// null the moment `isTerminal(situation.status)` is true), so this filter is
// not what makes re-sweeping a closed match safe — that is the domain
// layer's job, and it does it on its own. This filter exists so the
// candidate set stays small: it is the other half of `match_sweep_idx`
// alongside `deadlineAt`, keeping the query a cheap index lookup instead of
// a scan that grows with every match the sweep has ever closed.
//
// `inArray` on the leading column of `match_sweep_idx`, not `notInArray`: a
// `NOT IN` cannot use a `(status, deadline_at)` index as a prefix, so
// Postgres would fall back to a scan instead of range-scanning `deadlineAt`
// and satisfying the `ORDER BY` from the index — exactly the growth this
// filter exists to contain.

// Measured against a real backlog (300 synthetic due matches, each closed in
// its own transaction over a pooled websocket connection): ~93ms/row. A
// Vercel cron invocation's wall-clock budget is as low as 10s on the
// cheapest plan, so a batch of 50 (~4.7s at that rate) leaves comfortable
// headroom for connection setup and the batch select below, on top of
// whatever the production network adds. Ordering by `deadlineAt` ascending
// means the oldest expiries always drain first, so a steady trickle of new
// ones can never starve a backlog from ever being cleared — the cron's daily
// cadence (Vercel Hobby allows nothing finer) just takes more runs to catch
// up. The batch's
// match-changed pings go out concurrently after the loop, so publishing adds
// at most one `PUBLISH_TIMEOUT_MS` (2s) to the batch, not 2s per match.
const SWEEP_BATCH_LIMIT = 50;

/**
 * Closes one match if, as it stands right now, its deadline has passed.
 *
 * The match and its players are re-read here, locked `FOR UPDATE` in the
 * same order as `participantRows` (match first, then players). The sweep's
 * batch query read them without a lock, and a move or give-up can complete a
 * match between that read and this write; trusting the stale row would
 * overwrite a completion that already committed. Under the lock the
 * decision is made on the committed state: a match that is no longer open,
 * or whose expiry outcome is now `none`, is left untouched.
 *
 * Returns whether the match was closed. It publishes nothing: the caller
 * announces the closed matches after commit (see `sweepExpiredMatches`).
 */
export async function closeIfExpired(
  db: typeof Database,
  matchId: string,
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(match)
      .where(eq(match.id, matchId))
      .for("update");
    if (!row || !OPEN_STATUSES.includes(row.status)) return false;

    const seated = await tx
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, matchId))
      .for("update");

    const outcome = resolveExpiry(situationFor(row, seated), now);
    if (outcome.kind === "none") return false;

    if (outcome.forfeitedBy.length > 0) {
      await tx
        .update(matchPlayer)
        .set({ forfeitedAt: now })
        .where(
          and(
            eq(matchPlayer.matchId, matchId),
            inArray(matchPlayer.userId, [...outcome.forfeitedBy]),
          ),
        );
    }

    await tx
      .update(match)
      .set(
        outcome.kind === "complete"
          ? {
              status: "complete",
              endReason: outcome.endReason,
              winnerId: outcome.winnerId,
              lastActivityAt: now,
              endedAt: now,
            }
          : {
              status: "abandoned",
              endReason: "abandoned",
              winnerId: null,
              lastActivityAt: now,
              endedAt: now,
            },
      )
      .where(eq(match.id, matchId));

    return true;
  });
}

/**
 * Closes every match whose deadline has passed, so a stale match ends on its
 * own rather than waiting for someone to open it (spec §9.1).
 *
 * One indexed query finds the candidates — which is the whole reason
 * `deadlineAt` is a single column rather than six rules evaluated in
 * application code. It is capped at `SWEEP_BATCH_LIMIT` per call so one
 * invocation can never blow past a cron platform's wall-clock limit; `capped`
 * tells the caller whether this call drained every due match or whether more
 * are waiting for the next one. Each candidate is re-checked under lock by
 * `closeIfExpired`, so a match a player just completed is never overwritten.
 */
export async function sweepExpiredMatches(
  db: typeof Database,
  now: Date,
): Promise<{ closed: number; capped: boolean }> {
  const due = await db
    .select()
    .from(match)
    .where(
      and(inArray(match.status, OPEN_STATUSES), lte(match.deadlineAt, now)),
    )
    .orderBy(asc(match.deadlineAt))
    .limit(SWEEP_BATCH_LIMIT);

  if (due.length === 0) return { closed: 0, capped: false };

  const closed: string[] = [];

  try {
    for (const row of due) {
      if (await closeIfExpired(db, row.id, now)) closed.push(row.id);
    }
  } finally {
    // Committed closes are pinged even if a later one throws; publishSafely
    // never throws, so this cannot mask that error. Concurrently, so the
    // batch spends at most one publish timeout on them.
    await Promise.all(closed.map(publishMatchChanged));
  }

  // A full batch means there may be more due matches than this call fetched;
  // the next invocation picks up where this one left off, oldest first.
  return { closed: closed.length, capped: due.length === SWEEP_BATCH_LIMIT };
}
