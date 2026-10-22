import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decidingField,
  elapsedMs,
  resolveCompletion,
  type RunFacts,
} from "~/match";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function run(over: Partial<RunFacts> = {}): RunFacts {
  return {
    userId: "a",
    startedAt: null,
    finishedAt: null,
    gaveUpAt: null,
    penalties: 0,
    moves: 0,
    ...over,
  };
}

function finished(
  userId: string,
  penalties: number,
  moves: number,
  elapsed: number,
): RunFacts {
  return run({
    userId,
    penalties,
    moves,
    startedAt: at(1000),
    finishedAt: at(1000 + elapsed),
  });
}

describe("elapsedMs", () => {
  it("runs from the first move to the finish", () => {
    expect(elapsedMs(finished("a", 0, 1, 4500))).toBe(4500);
  });

  it("is null for a run that has not finished", () => {
    expect(elapsedMs(run({ startedAt: at(1) }))).toBeNull();
  });
});

describe("resolveCompletion", () => {
  it("waits while either run is unfinished", () => {
    expect(
      resolveCompletion([finished("a", 0, 10, 10), run({ userId: "b" })]),
    ).toEqual({ kind: "none" });
  });

  it("waits with only one player seated", () => {
    expect(resolveCompletion([finished("a", 0, 10, 10)])).toEqual({
      kind: "none",
    });
  });

  it("gives the win to fewer penalties, whatever the moves and time", () => {
    expect(
      resolveCompletion([finished("a", 3, 10, 10), finished("b", 2, 99, 99)]),
    ).toEqual({ kind: "complete", winnerId: "b", endReason: "finished" });
  });

  it("calls equal penalties a draw, whatever the moves", () => {
    expect(
      resolveCompletion([finished("a", 2, 12, 10), finished("b", 2, 14, 10)]),
    ).toEqual({ kind: "complete", winnerId: null, endReason: "finished" });
  });

  it("calls equal penalties a draw, whatever the time", () => {
    expect(
      resolveCompletion([finished("a", 2, 12, 900), finished("b", 2, 12, 800)]),
    ).toEqual({ kind: "complete", winnerId: null, endReason: "finished" });
  });

  it("calls equal penalties a draw when moves and time both differ", () => {
    expect(
      resolveCompletion([finished("a", 0, 40, 100), finished("b", 0, 11, 9)]),
    ).toEqual({ kind: "complete", winnerId: null, endReason: "finished" });
  });

  it("completes a perfect tie with no winner", () => {
    expect(
      resolveCompletion([finished("a", 2, 12, 800), finished("b", 2, 12, 800)]),
    ).toEqual({ kind: "complete", winnerId: null, endReason: "finished" });
  });

  it("decides on penalties alone, for any two finished runs", () => {
    const arbFinished = (userId: string) =>
      fc
        .tuple(fc.nat(5), fc.nat(50), fc.nat(5000))
        .map(([p, m, t]) => finished(userId, p, m, t));
    fc.assert(
      fc.property(arbFinished("a"), arbFinished("b"), (a, b) => {
        const expected =
          a.penalties < b.penalties ? "a" : a.penalties > b.penalties ? "b" : null;
        expect(resolveCompletion([a, b])).toEqual({
          kind: "complete",
          winnerId: expected,
          endReason: "finished",
        });
      }),
    );
  });

  it("awards a give-up to the opponent who has not moved at all", () => {
    expect(
      resolveCompletion([
        run({ userId: "a", gaveUpAt: at(5), startedAt: at(1), moves: 3 }),
        run({ userId: "b" }),
      ]),
    ).toEqual({ kind: "complete", winnerId: "b", endReason: "forfeit" });
  });

  it("awards a give-up to an opponent who already finished", () => {
    expect(
      resolveCompletion([
        finished("a", 9, 40, 100),
        run({ userId: "b", gaveUpAt: at(5) }),
      ]),
    ).toEqual({ kind: "complete", winnerId: "a", endReason: "forfeit" });
  });

  it("always names the other player when someone gives up", () => {
    const arbRun = (userId: string) =>
      fc.record({
        userId: fc.constant(userId),
        startedAt: fc.option(fc.constant(at(1)), { nil: null }),
        finishedAt: fc.option(fc.constant(at(9)), { nil: null }),
        gaveUpAt: fc.constant(null),
        penalties: fc.nat(50),
        moves: fc.nat(500),
      });
    fc.assert(
      fc.property(arbRun("a"), arbRun("b"), fc.boolean(), (a, b, aQuits) => {
        const players = aQuits
          ? [{ ...a, gaveUpAt: at(5), finishedAt: null }, b]
          : [a, { ...b, gaveUpAt: at(5), finishedAt: null }];
        const outcome = resolveCompletion(players);
        expect(outcome).toEqual({
          kind: "complete",
          winnerId: aQuits ? "b" : "a",
          endReason: "forfeit",
        });
      }),
    );
  });

  it("never completes as finished unless both reached the treasure", () => {
    const arbRun = (userId: string) =>
      fc.record({
        userId: fc.constant(userId),
        startedAt: fc.option(fc.constant(at(1)), { nil: null }),
        finishedAt: fc.option(fc.constant(at(9)), { nil: null }),
        gaveUpAt: fc.constant(null),
        penalties: fc.nat(50),
        moves: fc.nat(500),
      });
    fc.assert(
      fc.property(arbRun("a"), arbRun("b"), (a, b) => {
        const outcome = resolveCompletion([a, b]);
        if (outcome.kind === "complete" && outcome.endReason === "finished") {
          expect(a.finishedAt).not.toBeNull();
          expect(b.finishedAt).not.toBeNull();
        }
      }),
    );
  });

  it("ranks the same regardless of seat order", () => {
    const arbFinished = (userId: string) =>
      fc
        .tuple(fc.nat(5), fc.nat(5), fc.nat(5))
        .map(([p, m, t]) => finished(userId, p, m, t));
    fc.assert(
      fc.property(arbFinished("a"), arbFinished("b"), (a, b) => {
        expect(resolveCompletion([a, b])).toEqual(resolveCompletion([b, a]));
      }),
    );
  });
});

describe("decidingField", () => {
  it("is penalties when they differ", () => {
    expect(decidingField(finished("a", 1, 9, 9), finished("b", 2, 9, 9))).toBe(
      "penalties",
    );
  });

  it("is null when penalties are level, however moves and time differ", () => {
    expect(
      decidingField(finished("a", 2, 9, 9), finished("b", 2, 8, 9)),
    ).toBeNull();
    expect(
      decidingField(finished("a", 2, 8, 7), finished("b", 2, 8, 9)),
    ).toBeNull();
  });

  it("is null for a perfect tie, or when either run is unfinished", () => {
    expect(
      decidingField(finished("a", 2, 8, 9), finished("b", 2, 8, 9)),
    ).toBeNull();
    expect(
      decidingField(finished("a", 2, 8, 9), run({ userId: "b" })),
    ).toBeNull();
  });
});
