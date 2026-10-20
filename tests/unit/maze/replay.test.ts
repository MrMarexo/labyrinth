import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GATED_MAZE_ROUTE, gatedMazeDraft } from "~/lib/open-maze";
import { advanceRun, freshRun, mazeSchema } from "~/maze";
import { frameAt, mergeMoves, playable, type LoggedMove } from "~/maze/replay";

/** The gated seed walked by its route: 11 logged moves, 1 penalty. */
function loggedRoute(): LoggedMove[] {
  const maze = mazeSchema.parse(gatedMazeDraft());
  let run = freshRun(maze);
  return GATED_MAZE_ROUTE.map((dir, i) => {
    const step = advanceRun(run, maze, dir);
    run = step.run;
    return { seq: i + 1, delta: step.delta };
  });
}

describe("frameAt", () => {
  it("is the start at step 0", () => {
    const frame = frameAt(loggedRoute(), 0);
    expect(frame).toMatchObject({
      at: { x: 0, y: 0 },
      penalties: 0,
      moves: 0,
      finished: false,
      last: null,
      path: [{ x: 0, y: 0 }],
    });
    expect(frame.map.cells).toEqual([{ x: 0, y: 0 }]);
  });

  it("matches the run at every step", () => {
    const moves = loggedRoute();
    const maze = mazeSchema.parse(gatedMazeDraft());
    let run = freshRun(maze);
    for (const [i, dir] of GATED_MAZE_ROUTE.entries()) {
      run = advanceRun(run, maze, dir).run;
      const frame = frameAt(moves, i + 1);
      expect(frame.map).toEqual(run.view.map);
      expect(frame.at).toEqual(run.view.at);
      expect(frame.penalties).toBe(run.state.penalties);
    }
  });

  it("clamps a step outside the timeline", () => {
    const moves = loggedRoute();
    expect(frameAt(moves, -3)).toEqual(frameAt(moves, 0));
    expect(frameAt(moves, 99)).toEqual(frameAt(moves, moves.length));
    expect(frameAt(moves, 99).finished).toBe(true);
  });
});

describe("mergeMoves and playable", () => {
  it("is the same whatever order and duplication the moves arrive in", () => {
    const moves = loggedRoute();
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: moves.length - 1 }), {
          maxLength: 40,
        }),
        fc.integer({ min: 0, max: moves.length }),
        (arrivals, knownCount) => {
          const known = moves.slice(0, knownCount);
          const incoming = arrivals.map((i) => moves[i]!);
          const merged = mergeMoves(known, incoming);
          const seqs = merged.map((m) => m.seq);
          expect(seqs).toEqual([...new Set(seqs)].sort((a, b) => a - b));
          // Everything known or arrived is there, exactly once.
          const expected = new Set([
            ...known.map((m) => m.seq),
            ...incoming.map((m) => m.seq),
          ]);
          expect(new Set(seqs)).toEqual(expected);
        },
      ),
    );
  });

  it("keeps the first copy of a seq it already has", () => {
    const [first] = loggedRoute();
    const impostor = { seq: 1, delta: { ...first!.delta, penalties: 99 } };
    expect(mergeMoves([first!], [impostor])).toEqual([first]);
  });

  it("plays only the unbroken prefix from seq 1", () => {
    const moves = loggedRoute();
    const withGap = mergeMoves([], [moves[0]!, moves[1]!, moves[3]!]);
    expect(playable(withGap).map((m) => m.seq)).toEqual([1, 2]);
    const filled = mergeMoves(withGap, [moves[2]!]);
    expect(playable(filled).map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(playable(mergeMoves([], [moves[4]!]))).toEqual([]);
  });
});
