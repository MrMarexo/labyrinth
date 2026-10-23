import type { ParsedChannel } from "./channels";
import { isTerminal, type MatchStatus } from "./status";

/** What the watching rules need to know, from one player's point of view. */
export type WatchFacts = {
  status: MatchStatus;
  you: { userId: string; submittedAt: Date | null; finishedAt: Date | null };
  opponent: { userId: string; submittedAt: Date | null } | null;
};

function bothSubmitted(f: WatchFacts): boolean {
  return (
    f.opponent !== null &&
    f.you.submittedAt !== null &&
    f.opponent.submittedAt !== null
  );
}

/**
 * Spec §8: you may watch the opponent walk your maze only once your own run
 * is over. Before that, their live progress would be a known target to play
 * to, which is what withholding the result (§9) exists to prevent.
 */
export function mayWatchOpponent(f: WatchFacts): boolean {
  if (!bothSubmitted(f)) return false;
  return f.you.finishedAt !== null || isTerminal(f.status);
}

/**
 * Your own run, through the opponent's maze: only once the match is over —
 * the same rule as the result screen (§10.3.1), since it shows their maze.
 */
export function mayReplayOwn(f: WatchFacts): boolean {
  return bothSubmitted(f) && isTerminal(f.status);
}

/**
 * The one subscription rule (§8.1). The caller has already established that
 * `f.you` is a participant in `channel.matchId`; this decides which of that
 * match's channels they may join.
 */
export function maySubscribe(
  channel: Extract<ParsedChannel, { kind: "match" | "run" }>,
  f: WatchFacts,
): boolean {
  if (channel.kind === "match") return true;
  // A runner joins their own channel only to count the watchers.
  if (channel.runnerId === f.you.userId) return true;
  if (channel.runnerId === f.opponent?.userId) return mayWatchOpponent(f);
  return false;
}
