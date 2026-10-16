import { describe, expect, it } from "vitest";

import {
  HOURS_24_MS,
  HOURS_48_MS,
  deadlineFor,
  resolveExpiry,
  type MatchSituation,
  type PlayerSituation,
} from "~/match";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function player(over: Partial<PlayerSituation> = {}): PlayerSituation {
  return {
    userId: "a",
    submittedAt: null,
    lastMoveAt: null,
    finishedAt: null,
    ...over,
  };
}

function situation(over: Partial<MatchSituation> = {}): MatchSituation {
  return {
    status: "awaiting_opponent",
    createdAt: T0,
    bothJoinedAt: null,
    unlockedAt: null,
    lastActivityAt: T0,
    players: [player({ userId: "a" })],
    ...over,
  };
}

describe("deadlineFor — §9.1 row by row", () => {
  it("row 1: nobody has joined — 24h from creation", () => {
    expect(deadlineFor(situation())).toEqual(at(HOURS_24_MS));
  });

  it("row 2: both joined, neither submitted — 48h from the last activity", () => {
    const s = situation({
      status: "drawing",
      bothJoinedAt: at(1000),
      lastActivityAt: at(5000),
      players: [player({ userId: "a" }), player({ userId: "b" })],
    });
    expect(deadlineFor(s)).toEqual(at(5000 + HOURS_48_MS));
  });

  it("row 3: one submitted, the other has not — 24h from that submission", () => {
    const s = situation({
      status: "drawing",
      bothJoinedAt: at(1000),
      lastActivityAt: at(9000),
      players: [
        player({ userId: "a", submittedAt: at(7000) }),
        player({ userId: "b" }),
      ],
    });
    // Anchored to the submission, not to lastActivityAt: the clock is on the
    // player who has not drawn.
    expect(deadlineFor(s)).toEqual(at(7000 + HOURS_24_MS));
  });

  it("row 4: both submitted, neither has moved — 24h from the runs unlocking", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(8000),
      players: [
        player({ userId: "a", submittedAt: at(7000) }),
        player({ userId: "b", submittedAt: at(8000) }),
      ],
    });
    expect(deadlineFor(s)).toEqual(at(8000 + HOURS_24_MS));
  });

  it("row 5: both have moved, neither has finished — 48h since the last move by either", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(20_000),
      players: [
        player({ userId: "a", submittedAt: at(7000), lastMoveAt: at(12_000) }),
        player({ userId: "b", submittedAt: at(8000), lastMoveAt: at(20_000) }),
      ],
    });
    expect(deadlineFor(s)).toEqual(at(20_000 + HOURS_48_MS));
  });

  it("row 6: one has moved, the other has not — 24h from the mover's last move", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(50_000),
      players: [
        player({ userId: "a", submittedAt: at(7000), lastMoveAt: at(50_000) }),
        player({ userId: "b", submittedAt: at(8000) }),
      ],
    });
    // Not 24h from the unlocking: a player who is moving is engaged, and
    // nothing expires from under an engaged player.
    expect(deadlineFor(s)).toEqual(at(50_000 + HOURS_24_MS));
  });

  it("row 7: one found the treasure — 24h from that finish", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(30_000),
      players: [
        player({
          userId: "a",
          submittedAt: at(7000),
          lastMoveAt: at(30_000),
          finishedAt: at(30_000),
        }),
        player({ userId: "b", submittedAt: at(8000), lastMoveAt: at(25_000) }),
      ],
    });
    expect(deadlineFor(s)).toEqual(at(30_000 + HOURS_24_MS));
  });

  it("row 7 outranks row 5 even when the other player moved more recently", () => {
    // A finish freezes the match onto the 24h clock. If the non-finisher's
    // later move reset it to 48h, the finisher would wait two days for a
    // result that is already decided.
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(40_000),
      players: [
        player({
          userId: "a",
          submittedAt: at(7000),
          lastMoveAt: at(30_000),
          finishedAt: at(30_000),
        }),
        player({ userId: "b", submittedAt: at(8000), lastMoveAt: at(40_000) }),
      ],
    });
    expect(deadlineFor(s)).toEqual(at(30_000 + HOURS_24_MS));
  });

  it("returns null for a match that has already ended", () => {
    expect(deadlineFor(situation({ status: "complete" }))).toBeNull();
    expect(deadlineFor(situation({ status: "abandoned" }))).toBeNull();
  });
});

describe("resolveExpiry", () => {
  it("does nothing before the deadline", () => {
    const s = situation();
    expect(resolveExpiry(s, at(HOURS_24_MS - 1))).toEqual({ kind: "none" });
  });

  it("abandons an unjoined match with no winner and nobody at fault", () => {
    const s = situation();
    expect(resolveExpiry(s, at(HOURS_24_MS))).toEqual({
      kind: "abandoned",
      forfeitedBy: [],
    });
  });

  it("records the drawing forfeit against the player who did not draw", () => {
    const s = situation({
      status: "drawing",
      bothJoinedAt: at(1000),
      lastActivityAt: at(7000),
      players: [
        player({ userId: "a", submittedAt: at(7000) }),
        player({ userId: "b" }),
      ],
    });
    expect(resolveExpiry(s, at(7000 + HOURS_24_MS))).toEqual({
      kind: "abandoned",
      forfeitedBy: ["b"],
    });
  });

  it("records the one-moved forfeit against the player who never moved", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(50_000),
      players: [
        player({ userId: "a", submittedAt: at(7000), lastMoveAt: at(50_000) }),
        player({ userId: "b", submittedAt: at(8000) }),
      ],
    });
    expect(resolveExpiry(s, at(50_000 + HOURS_24_MS))).toEqual({
      kind: "abandoned",
      forfeitedBy: ["b"],
    });
  });

  it("blames nobody when both moved and both went quiet", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(20_000),
      players: [
        player({ userId: "a", submittedAt: at(7000), lastMoveAt: at(12_000) }),
        player({ userId: "b", submittedAt: at(8000), lastMoveAt: at(20_000) }),
      ],
    });
    expect(resolveExpiry(s, at(20_000 + HOURS_48_MS))).toEqual({
      kind: "abandoned",
      forfeitedBy: [],
    });
  });

  it("gives the finisher the win when the other player runs out of time", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(30_000),
      players: [
        player({
          userId: "a",
          submittedAt: at(7000),
          lastMoveAt: at(30_000),
          finishedAt: at(30_000),
        }),
        player({ userId: "b", submittedAt: at(8000), lastMoveAt: at(25_000) }),
      ],
    });
    expect(resolveExpiry(s, at(30_000 + HOURS_24_MS))).toEqual({
      kind: "complete",
      winnerId: "a",
      endReason: "forfeit",
      forfeitedBy: ["b"],
    });
  });

  it("never produces a winner who did not reach the treasure", () => {
    // The spec's load-bearing principle, asserted directly rather than
    // inferred from the cases above. Every combination of submitted/moved/
    // finished across two players, at a time far past any deadline.
    const stamps = [null, at(5000)] as const;
    for (const aSub of stamps)
      for (const aMove of stamps)
        for (const aFin of stamps)
          for (const bSub of stamps)
            for (const bMove of stamps)
              for (const bFin of stamps)
                for (const status of [
                  "awaiting_opponent",
                  "drawing",
                  "running",
                ] as const) {
                  const s = situation({
                    status,
                    bothJoinedAt: at(1000),
                    unlockedAt: at(2000),
                    lastActivityAt: at(5000),
                    players: [
                      player({
                        userId: "a",
                        submittedAt: aSub,
                        lastMoveAt: aMove,
                        finishedAt: aFin,
                      }),
                      player({
                        userId: "b",
                        submittedAt: bSub,
                        lastMoveAt: bMove,
                        finishedAt: bFin,
                      }),
                    ],
                  });
                  const outcome = resolveExpiry(s, at(HOURS_48_MS * 10));
                  if (outcome.kind !== "complete") continue;
                  const winner = s.players.find(
                    (p) => p.userId === outcome.winnerId,
                  );
                  expect(winner?.finishedAt).not.toBeNull();
                }
  });
});
