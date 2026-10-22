import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GATED_MAZE_ROUTE, gatedMazeDraft } from "~/lib/open-maze";
import {
  DIRECTIONS,
  advanceRun,
  freshRun,
  mazeSchema,
  predictMove,
  rebaseRun,
  sameDelta,
  type Direction,
  type Maze,
  type StoredRun,
} from "~/maze";

/** Key to the west of the start, gate 1 to the east, treasure beyond it. */
function corridor(): Maze {
  return {
    version: 1,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
    start: { x: 1, y: 0 },
    treasure: { x: 3, y: 0 },
    segments: [{ o: "V", x: 1, y: 0, kind: "gate", gate: 1 }],
    keys: [{ gate: 1, x: 0, y: 0 }],
  };
}

function walk(maze: Maze, dirs: readonly Direction[]): StoredRun {
  let run = freshRun(maze);
  for (const dir of dirs) run = advanceRun(run, maze, dir).run;
  return run;
}

/** What the client knows: the view plus the two counters. */
function known(run: StoredRun) {
  return {
    at: run.view.at,
    map: run.view.map,
    penalties: run.state.penalties,
    moves: run.state.moves,
  };
}

function actual(maze: Maze, run: StoredRun, dir: Direction) {
  return advanceRun(run, maze, dir).delta;
}

describe("predictMove", () => {
  it("predicts a move back through a known passage exactly", () => {
    const maze = corridor();
    const run = walk(maze, ["W"]);
    const predicted = predictMove(known(run), "E");
    expect(predicted).not.toBeNull();
    expect(sameDelta(predicted!, actual(maze, run, "E"))).toBe(true);
    expect(predicted).toMatchObject({
      outcome: "moved",
      from: { x: -1, y: 0 },
      at: { x: 0, y: 0 },
      penalties: 0,
      moves: 2,
      finished: false,
    });
  });

  it("predicts the key on a revisited key cell", () => {
    const maze = corridor();
    const run = walk(maze, ["W", "E"]);
    const predicted = predictMove(known(run), "W");
    expect(predicted).toMatchObject({
      outcome: "moved_found_key",
      revealedCell: { x: -1, y: 0, key: 1 },
    });
    expect(sameDelta(predicted!, actual(maze, run, "W"))).toBe(true);
  });

  it("does not predict an edge never tried", () => {
    expect(predictMove(known(walk(corridor(), [])), "W")).toBeNull();
  });

  it("does not predict a known wall", () => {
    // W to the key, W into the boundary: a known wall now.
    expect(predictMove(known(walk(corridor(), ["W", "W"])), "W")).toBeNull();
  });

  it("does not predict a gate not yet crossed, even holding its key", () => {
    // E bumps the gate; W, E fetches the key and comes back.
    const run = walk(corridor(), ["E", "W", "E"]);
    expect(run.state.keys).toBe(1);
    expect(predictMove(known(run), "E")).toBeNull();
  });

  it("predicts a gate already crossed, as a crossing", () => {
    const maze = corridor();
    // Key, back, through the gate, back again.
    const run = walk(maze, ["W", "E", "E", "W"]);
    const predicted = predictMove(known(run), "E");
    expect(predicted).toMatchObject({
      outcome: "moved_through_gate",
      revealedSegment: { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
    });
    expect(sameDelta(predicted!, actual(maze, run, "E"))).toBe(true);
  });

  it("never predicts anything the server would not answer", () => {
    const maze = mazeSchema.parse(gatedMazeDraft());
    // The route stops one short of the treasure, so the walk stays open.
    const prefix = GATED_MAZE_ROUTE.slice(0, -1);
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Direction>(...DIRECTIONS), { maxLength: 30 }),
        fc.integer({ min: 0, max: prefix.length }),
        fc.constantFrom<Direction>(...DIRECTIONS),
        (wander, take, dir) => {
          const run = walk(maze, [...prefix.slice(0, take), ...wander]);
          if (run.state.finished) return;
          const predicted = predictMove(known(run), dir);
          if (predicted === null) return;
          expect(sameDelta(predicted, actual(maze, run, dir))).toBe(true);
        },
      ),
    );
  });
});

describe("sameDelta", () => {
  it("ignores key order and absent optional fields", () => {
    const maze = corridor();
    const delta = actual(maze, walk(maze, []), "W");
    const reordered = JSON.parse(
      JSON.stringify({ ...delta, revealedSegment: undefined }),
    ) as typeof delta;
    expect(sameDelta(delta, reordered)).toBe(true);
  });

  it("tells a different outcome or position apart", () => {
    const maze = corridor();
    const a = actual(maze, walk(maze, []), "W");
    expect(sameDelta(a, { ...a, penalties: 1 })).toBe(false);
    expect(sameDelta(a, { ...a, at: { x: 0, y: 0 } })).toBe(false);
    expect(sameDelta(a, { ...a, revealedCell: { x: -1, y: 0 } })).toBe(false);
  });
});

describe("rebaseRun", () => {
  function snapshot(run: StoredRun) {
    return { ...known(run), finished: run.state.finished };
  }

  it("replays deltas the snapshot has not seen yet, in order", () => {
    const maze = corridor();
    const before = walk(maze, ["W"]);
    const deltas = [];
    let run = before;
    for (const dir of ["E", "W", "E"] as const) {
      const next = advanceRun(run, maze, dir);
      deltas.push(next.delta);
      run = next.run;
    }
    expect(rebaseRun(snapshot(before), deltas)).toEqual(snapshot(run));
  });

  it("skips deltas the snapshot already includes", () => {
    const maze = corridor();
    const first = advanceRun(freshRun(maze), maze, "W");
    const second = advanceRun(first.run, maze, "E");
    expect(rebaseRun(snapshot(first.run), [first.delta, second.delta])).toEqual(
      snapshot(second.run),
    );
  });

  it("leaves the snapshot alone when the deltas do not follow on from it", () => {
    const maze = corridor();
    const first = advanceRun(freshRun(maze), maze, "W");
    const second = advanceRun(first.run, maze, "E");
    const fresh = snapshot(freshRun(maze));
    expect(rebaseRun(fresh, [second.delta])).toEqual(fresh);
  });
});
