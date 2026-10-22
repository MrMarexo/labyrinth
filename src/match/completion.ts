/**
 * What the completion rules need to know about one player's run. Built from
 * a `match_player` row by the server; plain data here.
 */
export type RunFacts = {
  userId: string;
  /** The first move. Null until the runner has moved. */
  startedAt: Date | null;
  /** The move that reached the treasure. */
  finishedAt: Date | null;
  /** Spec §9.2. */
  gaveUpAt: Date | null;
  penalties: number;
  moves: number;
};

/**
 * Spec §2.6: bumps (stored as `penalties`) are the only score. Moves and
 * time are recorded and shown, and never decide anything.
 */
export type DecidingField = "penalties";

export type Completion =
  | { kind: "none" }
  | {
      kind: "complete";
      /** Null for a draw: equal penalties (spec §2.6). */
      winnerId: string | null;
      endReason: "finished" | "forfeit";
    };

/**
 * Spec §2.6: from the runner's first move to the move that reached the
 * treasure. Not from the unlocking — runs are asynchronous, and a player who
 * starts a day later has not been slower.
 */
export function elapsedMs(run: RunFacts): number | null {
  if (run.startedAt === null || run.finishedAt === null) return null;
  return run.finishedAt.getTime() - run.startedAt.getTime();
}

/**
 * Negative when `a` ranks ahead, positive when `b` does, zero for a draw.
 * Fewest bumps wins; there is no tiebreak (spec §2.6).
 */
function compareFinished(a: RunFacts, b: RunFacts): number {
  return a.penalties - b.penalties;
}

/** What settled it, for the result screen; null for a draw or no finish. */
export function decidingField(a: RunFacts, b: RunFacts): DecidingField | null {
  if (elapsedMs(a) === null || elapsedMs(b) === null) return null;
  return a.penalties !== b.penalties ? "penalties" : null;
}

/**
 * Whether a running match is over, on anything other than a deadline — the
 * deadline rules are `resolveExpiry`'s, and the two never disagree, because
 * a match this function completes is terminal and `resolveExpiry` ignores
 * terminal matches.
 *
 * A give-up decides it immediately for the other player, finished or not
 * (spec §9.2). That is the one way to win without the treasure, and it is
 * deliberate: a concession is not silence. Otherwise both runs must have
 * reached the treasure, and §2.6 ranks them.
 */
export function resolveCompletion(players: readonly RunFacts[]): Completion {
  if (players.length !== 2) return { kind: "none" };
  const [a, b] = players as readonly [RunFacts, RunFacts];

  const quitter = [a, b].find((p) => p.gaveUpAt !== null);
  if (quitter) {
    const winner = quitter === a ? b : a;
    return { kind: "complete", winnerId: winner.userId, endReason: "forfeit" };
  }

  if (a.finishedAt === null || b.finishedAt === null) return { kind: "none" };

  const order = compareFinished(a, b);
  return {
    kind: "complete",
    endReason: "finished",
    winnerId: order < 0 ? a.userId : order > 0 ? b.userId : null,
  };
}
