import { type MatchSituation, type PlayerSituation } from "~/match";
import { type match, type matchPlayer } from "~/server/db/schema";

export type MatchRow = typeof match.$inferSelect;
export type PlayerRow = typeof matchPlayer.$inferSelect;

/**
 * The bridge from database rows to the pure domain's view of a match. Both
 * the `match` router and Task 5's sweep evaluate the same situations with
 * the same function — one reading of §9.1, not two.
 *
 * `lastMoveAt` and `finishedAt` are hardcoded null: the columns that would
 * feed them are Phase 4's and do not exist yet. That means rows 5 and 6 of
 * §9.1 are unreachable through this bridge, which is correct for Phase 3 —
 * nobody can move. Phase 4 fills them in here and both rows light up.
 */
export function situationFor(
  matchRow: MatchRow,
  playerRows: readonly PlayerRow[],
): MatchSituation {
  const players: PlayerSituation[] = playerRows.map((p) => ({
    userId: p.userId,
    submittedAt: p.submittedAt,
    lastMoveAt: null,
    finishedAt: null,
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
