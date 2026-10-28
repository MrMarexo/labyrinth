import { eq } from "drizzle-orm";

import { deadlineFor } from "~/match";
import { match, matchPlayer } from "~/server/db/schema";
import type { DbClient } from "~/server/match/access";
import {
  situationFor,
  type MatchRow,
  type PlayerRow,
} from "~/server/match/situation";

/**
 * Seats `userId` as the second player and moves the match to `drawing`.
 * The caller holds the match row locked and has already checked that the
 * match is open to this user, has a free seat and has not expired.
 */
export async function seatOpponent(
  tx: DbClient,
  row: MatchRow,
  players: PlayerRow[],
  userId: string,
  now: Date,
): Promise<void> {
  await tx.insert(matchPlayer).values({
    matchId: row.id,
    userId,
    joinedAt: now,
  });

  const seated: PlayerRow[] = [
    ...players,
    {
      matchId: row.id,
      userId,
      mazeHash: null,
      joinedAt: now,
      submittedAt: null,
      forfeitedAt: null,
      runState: null,
      startedAt: null,
      lastMoveAt: null,
      finishedAt: null,
      gaveUpAt: null,
    },
  ];
  const next: MatchRow = { ...row, status: "drawing", lastActivityAt: now };

  await tx
    .update(match)
    .set({
      status: "drawing",
      lastActivityAt: now,
      deadlineAt: deadlineFor(situationFor(next, seated))!,
    })
    .where(eq(match.id, row.id));
}
