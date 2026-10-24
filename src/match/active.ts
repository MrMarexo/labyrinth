import type { MatchStatus } from "./status";

/**
 * Whether a match still needs this player, which is what limits them to one
 * at a time: waiting for an opponent, drawing (submitted or not), or running
 * while their own run is unfinished. A player whose run is over — found the
 * treasure, gave up, or timed out — is free to start or join another while
 * the opponent is still solving theirs. A match past its deadline no longer
 * counts; the sweep, or the caller, closes it.
 */
export function holdsPlayer(
  match: { status: MatchStatus; deadlineAt: Date },
  player: {
    finishedAt: Date | null;
    gaveUpAt: Date | null;
    forfeitedAt: Date | null;
  },
  now: Date,
): boolean {
  if (match.deadlineAt.getTime() <= now.getTime()) return false;
  switch (match.status) {
    case "awaiting_opponent":
    case "drawing":
      return true;
    case "running":
      return (
        player.finishedAt === null &&
        player.gaveUpAt === null &&
        player.forfeitedAt === null
      );
    case "complete":
    case "abandoned":
      return false;
  }
}
