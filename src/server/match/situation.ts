import { type MatchSituation, type PlayerSituation } from "~/match";
import { type match, type matchPlayer } from "~/server/db/schema";

export type MatchRow = typeof match.$inferSelect;
export type PlayerRow = typeof matchPlayer.$inferSelect;

/**
 * The bridge from database rows to the pure domain's view of a match. Both
 * the `match` router and Task 5's sweep evaluate the same situations with
 * the same function — one reading of §9.1, not two.
 *
 * `lastMoveAt` and `finishedAt` come straight off the player rows; with
 * them, every row of §9.1 is reachable through this bridge.
 */
export function situationFor(
  matchRow: MatchRow,
  playerRows: readonly PlayerRow[],
): MatchSituation {
  const players: PlayerSituation[] = playerRows.map((p) => ({
    userId: p.userId,
    submittedAt: p.submittedAt,
    lastMoveAt: p.lastMoveAt,
    finishedAt: p.finishedAt,
  }));

  return {
    status: matchRow.status,
    createdAt: matchRow.createdAt,
    bothJoinedAt:
      playerRows.length === 2
        ? new Date(Math.max(...playerRows.map((p) => p.joinedAt.getTime())))
        : null,
    unlockedAt:
      playerRows.length === 2 && playerRows.every((p) => p.submittedAt !== null)
        ? new Date(Math.max(...playerRows.map((p) => p.submittedAt!.getTime())))
        : null,
    lastActivityAt: matchRow.lastActivityAt,
    players,
  };
}
