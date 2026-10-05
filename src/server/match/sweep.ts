import { and, eq, inArray, lte, notInArray } from "drizzle-orm";

import { MATCH_STATUSES, isTerminal, resolveExpiry } from "~/match";
import type { db as Database } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";
// `situationFor` lives in its own module, not in the router: a server-side
// domain helper should not have to be reached through a tRPC router, and the
// sweep is its second consumer.
import { situationFor } from "~/server/match/situation";

const TERMINAL = MATCH_STATUSES.filter(isTerminal);

/**
 * Closes every match whose deadline has passed, so a stale match ends on its
 * own rather than waiting for someone to open it (spec §9.1).
 *
 * One indexed query finds the candidates — which is the whole reason
 * `deadlineAt` is a single column rather than six rules evaluated in
 * application code.
 *
 * Phase 3 note: `situationFor` reports `lastMoveAt` and `finishedAt` as null
 * because the columns that feed them are Phase 4's. So the `complete` branch
 * below is unreachable today and no test exercises it — that is expected,
 * not dead code. The moment Phase 4 fills those two fields in, §9.1 rows 5
 * and 6 start closing here with no change to this file.
 */
export async function sweepExpiredMatches(
  db: typeof Database,
  now: Date,
): Promise<{ closed: number }> {
  const due = await db
    .select()
    .from(match)
    .where(and(notInArray(match.status, TERMINAL), lte(match.deadlineAt, now)));

  if (due.length === 0) return { closed: 0 };

  const players = await db
    .select()
    .from(matchPlayer)
    .where(
      inArray(
        matchPlayer.matchId,
        due.map((m) => m.id),
      ),
    );

  let closed = 0;

  for (const row of due) {
    const seated = players.filter((p) => p.matchId === row.id);
    const outcome = resolveExpiry(situationFor(row, seated), now);
    if (outcome.kind === "none") continue;

    await db.transaction(async (tx) => {
      if (outcome.forfeitedBy.length > 0) {
        await tx
          .update(matchPlayer)
          .set({ forfeitedAt: now })
          .where(
            and(
              eq(matchPlayer.matchId, row.id),
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
              }
            : {
                status: "abandoned",
                endReason: "abandoned",
                winnerId: null,
                lastActivityAt: now,
              },
        )
        .where(eq(match.id, row.id));
    });

    closed += 1;
  }

  return { closed };
}
