import { isTerminal, type MatchStatus } from "./status";

export const HOURS_24_MS = 24 * 60 * 60 * 1000;
export const HOURS_48_MS = 48 * 60 * 60 * 1000;

export type PlayerSituation = {
  userId: string;
  submittedAt: Date | null;
  /** Phase 4 fills this. Null throughout Phase 3. */
  lastMoveAt: Date | null;
  /** Phase 4 fills this. Null throughout Phase 3. */
  finishedAt: Date | null;
};

export type MatchSituation = {
  status: MatchStatus;
  createdAt: Date;
  bothJoinedAt: Date | null;
  /** When both mazes were in and the runs unlocked. */
  unlockedAt: Date | null;
  lastActivityAt: Date;
  players: readonly PlayerSituation[];
};

export type ExpiryOutcome =
  | { kind: "none" }
  | { kind: "abandoned"; forfeitedBy: readonly string[] }
  | {
      kind: "complete";
      winnerId: string;
      endReason: "forfeit";
      forfeitedBy: readonly string[];
    };

const plus = (at: Date, ms: number) => new Date(at.getTime() + ms);

/**
 * Spec §9.1, in the spec's own row order — the order is the logic, because
 * later rows describe states that subsume earlier ones. A finish (row 6)
 * outranks a more recent move by the other player (row 5): once someone has
 * the treasure the result is decided, and leaving the 48h clock running
 * would make the finisher wait two days for it.
 *
 * Returns null for a match that has already ended; there is nothing left to
 * wait for.
 */
export function deadlineFor(situation: MatchSituation): Date | null {
  if (isTerminal(situation.status)) return null;

  const { players } = situation;
  const finished = players.filter((p) => p.finishedAt !== null);

  // Row 6 — one found the treasure, the other has not.
  if (finished.length === 1 && players.length === 2) {
    return plus(finished[0]!.finishedAt!, HOURS_24_MS);
  }

  const moved = players.filter((p) => p.lastMoveAt !== null);

  // Row 5 — both have moved, neither has finished.
  if (moved.length === 2) {
    const last = Math.max(...moved.map((p) => p.lastMoveAt!.getTime()));
    return plus(new Date(last), HOURS_48_MS);
  }

  // Row 4 — both submitted, neither has made a single move.
  if (situation.status === "running" && situation.unlockedAt !== null) {
    return plus(situation.unlockedAt, HOURS_24_MS);
  }

  const submitted = players.filter((p) => p.submittedAt !== null);

  // Row 3 — one submitted a maze, the other has not.
  if (submitted.length === 1 && players.length === 2) {
    return plus(submitted[0]!.submittedAt!, HOURS_24_MS);
  }

  // Row 2 — both joined, neither has submitted.
  if (situation.bothJoinedAt !== null) {
    return plus(situation.lastActivityAt, HOURS_48_MS);
  }

  // Row 1 — nobody has joined.
  return plus(situation.createdAt, HOURS_24_MS);
}

/**
 * What happens when the deadline passes.
 *
 * Every row but the last closes with **no winner** — including the case
 * where you drew your maze and your opponent never drew theirs. Missing a
 * deadline is recorded against the player who missed it, which is what a
 * future reliability stat would read, but it does not put an unearned win on
 * the other player's record.
 */
export function resolveExpiry(
  situation: MatchSituation,
  now: Date,
): ExpiryOutcome {
  const deadline = deadlineFor(situation);
  if (deadline === null || now.getTime() < deadline.getTime()) {
    return { kind: "none" };
  }

  const { players } = situation;
  const finished = players.filter((p) => p.finishedAt !== null);

  // Row 6 — the only row that produces a winner, and only for a player who
  // actually reached the treasure.
  if (finished.length === 1 && players.length === 2) {
    const winner = finished[0]!;
    return {
      kind: "complete",
      winnerId: winner.userId,
      endReason: "forfeit",
      forfeitedBy: players
        .filter((p) => p.userId !== winner.userId)
        .map((p) => p.userId),
    };
  }

  return { kind: "abandoned", forfeitedBy: blameFor(situation) };
}

/**
 * Who missed the deadline. Nobody is at fault when a match simply went
 * unjoined, or when both players went quiet together — fault is only
 * recorded where one player was waiting on another.
 */
function blameFor(situation: MatchSituation): readonly string[] {
  const { players } = situation;
  if (players.length < 2) return [];

  const submitted = players.filter((p) => p.submittedAt !== null);
  if (submitted.length === 1) {
    return players.filter((p) => p.submittedAt === null).map((p) => p.userId);
  }

  return [];
}
