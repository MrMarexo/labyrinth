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

export type DecidingField = "penalties" | "moves" | "time";

export type Completion =
  | { kind: "none" }
  | {
      kind: "complete";
      /** Null only for a perfect tie (spec §2.6). */
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

/** Negative when `a` ranks ahead, positive when `b` does, zero for a tie. */
function compareFinished(a: RunFacts, b: RunFacts): number {
  return (
    a.penalties - b.penalties ||
    a.moves - b.moves ||
    elapsedMs(a)! - elapsedMs(b)!
  );
}

/** Which tiebreaker settled it, for the result screen's "decided on …" line. */
export function decidingField(a: RunFacts, b: RunFacts): DecidingField | null {
  if (elapsedMs(a) === null || elapsedMs(b) === null) return null;
  if (a.penalties !== b.penalties) return "penalties";
  if (a.moves !== b.moves) return "moves";
  if (elapsedMs(a) !== elapsedMs(b)) return "time";
  return null;
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
