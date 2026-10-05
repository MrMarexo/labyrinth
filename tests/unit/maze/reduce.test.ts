import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DIRECTIONS, type Direction, type Maze } from "~/maze/format";
import { edgeBetween } from "~/maze/geometry";
import { applyMove, initialRunState, type RunnerDelta } from "~/maze/reduce";

/** Two cells side by side, treasure on the right. */
function pair(): Maze {
  return {
    version: 1,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    start: { x: 0, y: 0 },
    treasure: { x: 1, y: 0 },
    segments: [],
    keys: [],
  };
}

describe("applyMove", () => {
  it("moves into an open cell without penalty", () => {
    const maze = pair();
    const { state, delta, outcome } = applyMove(
      maze,
      initialRunState(maze),
      "E",
    );
    expect(outcome).toBe("moved_found_treasure");
    expect(state.at).toEqual({ x: 1, y: 0 });
    expect(state.penalties).toBe(0);
    expect(state.moves).toBe(1);
    expect(delta.finished).toBe(true);
  });

  it("charges a penalty for walking into a wall and does not move", () => {
    const maze = pair();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "wall" }];
    const { state, delta, outcome } = applyMove(
      maze,
      initialRunState(maze),
      "E",
    );
    expect(outcome).toBe("blocked_wall");
    expect(state.at).toEqual({ x: 0, y: 0 });
    expect(state.penalties).toBe(1);
    expect(delta.revealedSegment).toEqual({ o: "V", x: 0, y: 0, kind: "wall" });
  });

  it("charges a penalty for walking off the shape", () => {
    const maze = pair();
    const { state, outcome } = applyMove(maze, initialRunState(maze), "W");
    expect(outcome).toBe("blocked_boundary");
    expect(state.penalties).toBe(1);
    expect(state.at).toEqual({ x: 0, y: 0 });
  });

  it("picks up a key and reveals it", () => {
    const withKey: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
      // The gate gives the key a reason to exist; the move under test never
      // reaches it.
      segments: [{ o: "V", x: 1, y: 0, kind: "gate", gate: 2 }],
      keys: [{ gate: 2, x: 1, y: 0 }],
    };
    const { state, delta, outcome } = applyMove(
      withKey,
      initialRunState(withKey),
      "E",
    );
    expect(outcome).toBe("moved_found_key");
    expect(delta.revealedCell).toEqual({ x: 1, y: 0, key: 2 });
    expect(state.keys).toBe(1 << 1);
  });

  it("blocks a gate without its key, revealing which gate it is", () => {
    const maze = pair();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 3 }];
    maze.keys = [{ gate: 3, x: 1, y: 0 }];
    const { state, delta, outcome } = applyMove(
      maze,
      initialRunState(maze),
      "E",
    );
    expect(outcome).toBe("blocked_gate");
    expect(state.penalties).toBe(1);
    expect(delta.revealedSegment).toEqual({
      o: "V",
      x: 0,
      y: 0,
      kind: "gate",
      gate: 3,
    });
  });

  it("passes a gate once its key is held, and the gate stays open", () => {
    // The treasure deliberately sits one cell PAST the gate: if it sat
    // immediately behind it, the outcome would be moved_found_treasure and
    // this test would prove nothing about gates.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 1 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
      segments: [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 0, y: 1 }],
    };

    let state = initialRunState(maze);
    state = applyMove(maze, state, "S").state; // collect key 1
    const crossed = applyMove(maze, { ...state, at: { x: 0, y: 0 } }, "E");

    expect(crossed.outcome).toBe("moved_through_gate");
    expect(crossed.state.penalties).toBe(0);
    expect(crossed.state.openedGates).toBe(1 << 0);
    // Replay rebuilds the discovered map from the stored deltas alone (spec
    // §8), so a successful gate crossing must say a gate was there, even
    // though the runner bumped nothing — otherwise replay draws open floor
    // and the gate's id is lost for good.
    expect(crossed.delta.revealedSegment).toEqual({
      o: "V",
      x: 0,
      y: 0,
      kind: "gate",
      gate: 1,
    });
  });

  it("refuses to move once the run has finished", () => {
    const maze = pair();
    const finished = { ...initialRunState(maze), finished: true };
    const { state, outcome } = applyMove(maze, finished, "E");
    expect(outcome).toBe("blocked_wall");
    expect(state).toEqual(finished);
  });

  it("does not hand out the maze's own start object", () => {
    const maze = pair();
    const state = initialRunState(maze);
    state.at.x = 9;
    expect(maze.start).toEqual({ x: 0, y: 0 });
  });
});

describe("the delta is expressed relative to the start cell", () => {
  /**
   * A stored maze is `normalize`d, so its *bounding box* starts at the origin
   * — the start cell generally does not. Every fixture above happens to start
   * at (0, 0), which makes the relative frame indistinguishable from the
   * absolute one; this one starts at (2, 0) so the translation is visible,
   * and the expectations below are derived from that start cell by hand.
   *
   *   (0,0) (1,0) [gate 1] (2,0)=start
   *                        (2,1)=key 1
   *   treasure at (0,0)
   */
  function offset(): Maze {
    return {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
      ],
      start: { x: 2, y: 0 },
      treasure: { x: 0, y: 0 },
      segments: [{ o: "V", x: 1, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 2, y: 1 }],
    };
  }

  it("reports the start cell itself as the origin", () => {
    const maze = offset();
    // Walking east off the shape: the runner has not moved, so both ends of
    // the move are the start cell, which is (0, 0) in the runner's frame.
    const { delta } = applyMove(maze, initialRunState(maze), "E");
    expect(delta.from).toEqual({ x: 0, y: 0 });
    expect(delta.at).toEqual({ x: 0, y: 0 });
    // The bumped edge is V{2,0} in maze coordinates, i.e. V{0,0} from (2,0).
    expect(delta.revealedSegment).toEqual({
      o: "V",
      x: 0,
      y: 0,
      kind: "wall",
    });
  });

  it("translates a revealed cell and keeps the sign", () => {
    const maze = offset();
    // South from (2,0) to (2,1), which holds key 1: (2,1) - (2,0) = (0,1).
    const south = applyMove(maze, initialRunState(maze), "S");
    expect(south.outcome).toBe("moved_found_key");
    expect(south.delta.from).toEqual({ x: 0, y: 0 });
    expect(south.delta.at).toEqual({ x: 0, y: 1 });
    expect(south.delta.revealedCell).toEqual({ x: 0, y: 1, key: 1 });

    // North again, back to the start cell: `from` is now (0,1) and `at` (0,0).
    const north = applyMove(maze, south.state, "N");
    expect(north.outcome).toBe("moved");
    expect(north.delta.from).toEqual({ x: 0, y: 1 });
    expect(north.delta.at).toEqual({ x: 0, y: 0 });
    expect(north.delta.revealedCell).toEqual({ x: 0, y: 0 });
  });

  it("produces negative coordinates west of the start, and says so", () => {
    const maze = offset();
    // Bumping the gate before holding its key. Edge V{1,0} in maze
    // coordinates is V{-1,0} from the start cell at (2,0).
    const bumped = applyMove(maze, initialRunState(maze), "W");
    expect(bumped.outcome).toBe("blocked_gate");
    expect(bumped.delta.revealedSegment).toEqual({
      o: "V",
      x: -1,
      y: 0,
      kind: "gate",
      gate: 1,
    });

    // Now with key 1 in hand: through the gate to (1,0) = (-1,0), then on to
    // the treasure at (0,0) = (-2,0).
    let state = applyMove(maze, initialRunState(maze), "S").state;
    state = applyMove(maze, state, "N").state;
    const crossed = applyMove(maze, state, "W");
    expect(crossed.outcome).toBe("moved_through_gate");
    expect(crossed.delta.from).toEqual({ x: 0, y: 0 });
    expect(crossed.delta.at).toEqual({ x: -1, y: 0 });
    expect(crossed.delta.revealedCell).toEqual({ x: -1, y: 0 });
    expect(crossed.delta.revealedSegment).toEqual({
      o: "V",
      x: -1,
      y: 0,
      kind: "gate",
      gate: 1,
    });

    const won = applyMove(maze, crossed.state, "W");
    expect(won.outcome).toBe("moved_found_treasure");
    expect(won.delta.from).toEqual({ x: -1, y: 0 });
    expect(won.delta.at).toEqual({ x: -2, y: 0 });
    expect(won.delta.revealedCell).toEqual({ x: -2, y: 0, treasure: true });
  });

  it("reports the origin for a move refused after the run finished", () => {
    const maze = offset();
    const finished = { ...initialRunState(maze), finished: true };
    const { delta } = applyMove(maze, finished, "W");
    expect(delta.from).toEqual({ x: 0, y: 0 });
    expect(delta.at).toEqual({ x: 0, y: 0 });
  });
});

describe("the runner cannot tell a void square from a wall", () => {
  // Both mazes share a start cell at (1,1) and are bumped in the same
  // direction, so the edge the runner meets has the same address in both.
  // Only the reason it is blocked differs: in `voidAhead` the destination is
  // unpainted, in `walledAhead` it is painted and walled.
  function voidAhead(): Maze {
    return {
      version: 1,
      cells: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      start: { x: 1, y: 1 },
      treasure: { x: 1, y: 2 },
      segments: [],
      keys: [],
    };
  }

  function walledAhead(): Maze {
    return {
      version: 1,
      cells: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
      ],
      start: { x: 1, y: 1 },
      treasure: { x: 1, y: 2 },
      segments: [{ o: "V", x: 1, y: 1, kind: "wall" }],
      keys: [],
    };
  }

  it("produces byte-identical deltas for both", () => {
    // Spec §2.2 and invariant 6: this is the difference between a hidden maze
    // and a guessable one. Nothing is stripped before the comparison — if the
    // two deltas differ in any field at all, the runner can map by bumping.
    const open = voidAhead();
    const intoVoid = applyMove(open, initialRunState(open), "E");
    expect(intoVoid.outcome).toBe("blocked_boundary");

    const walled = walledAhead();
    const intoWall = applyMove(walled, initialRunState(walled), "E");
    expect(intoWall.outcome).toBe("blocked_wall");

    // The value both must produce, written out rather than read back: the
    // bumped edge is V{1,1} in maze coordinates, i.e. V{0,0} from the start.
    const expected: RunnerDelta = {
      outcome: "blocked_wall",
      from: { x: 0, y: 0 },
      at: { x: 0, y: 0 },
      penalties: 1,
      moves: 1,
      finished: false,
      revealedSegment: { o: "V", x: 0, y: 0, kind: "wall" },
    };

    expect(intoVoid.delta).toEqual(expected);
    expect(intoWall.delta).toEqual(expected);
    expect(JSON.stringify(intoVoid.delta)).toBe(JSON.stringify(intoWall.delta));
  });
});

describe("invariants", () => {
  const maze = pair();

  it("never decreases penalties or moves", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...DIRECTIONS), { maxLength: 40 }),
        (dirs) => {
          let state = initialRunState(maze);
          for (const dir of dirs) {
            const next = applyMove(maze, state, dir).state;
            expect(next.penalties).toBeGreaterThanOrEqual(state.penalties);
            expect(next.moves).toBeGreaterThanOrEqual(state.moves);
            state = next;
          }
        },
      ),
    );
  });
});

describe("the delta mentions nothing the runner has not touched", () => {
  /**
   * Spec §12: "the reducer never returns information about a cell the runner
   * has not touched". Key 1 sits in a pocket sealed by a wall and the
   * treasure sits behind gate 1, so from the start the runner can only ever
   * stand on (1,0) and (0,0) — both contents are permanently off their path.
   * That makes the maze unsolvable, which is fine here: the reducer does not
   * validate, and the point of the fixture is to give the reducer something
   * it could leak.
   */
  function sealedContents(): Maze {
    return {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 1 },
      ],
      start: { x: 1, y: 0 },
      treasure: { x: 2, y: 0 },
      segments: [
        { o: "V", x: 1, y: 0, kind: "gate", gate: 1 },
        { o: "H", x: 1, y: 0, kind: "wall" },
      ],
      keys: [{ gate: 1, x: 1, y: 1 }],
    };
  }

  const DELTA_FIELDS = [
    "outcome",
    "from",
    "at",
    "penalties",
    "moves",
    "finished",
    "revealedCell",
    "revealedSegment",
  ];

  /**
   * Every (x, y) anywhere in the value, tagged by orientation so an edge can
   * never be mistaken for a cell. A reducer that attached the whole maze, or
   * a neighbouring cell, or a second segment, shows up here.
   */
  function coordinatesIn(value: unknown, found: string[] = []): string[] {
    if (Array.isArray(value)) {
      for (const item of value) coordinatesIn(item, found);
      return found;
    }
    if (typeof value !== "object" || value === null) return found;
    const record = value as Record<string, unknown>;
    if (typeof record.x === "number" && typeof record.y === "number") {
      const tag = typeof record.o === "string" ? record.o : "cell";
      found.push(`${tag}:${record.x},${record.y}`);
    }
    for (const child of Object.values(record)) coordinatesIn(child, found);
    return found;
  }

  it("names only the cell entered and the edge bumped", () => {
    const maze = sealedContents();
    const origin = maze.start;
    const relCell = (p: { x: number; y: number }) =>
      `cell:${p.x - origin.x},${p.y - origin.y}`;
    const relEdge = (e: { o: string; x: number; y: number }) =>
      `${e.o}:${e.x - origin.x},${e.y - origin.y}`;

    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Direction>(...DIRECTIONS), { maxLength: 40 }),
        (dirs) => {
          let state = initialRunState(maze);
          for (const dir of dirs) {
            const before = state.at;
            const { state: next, delta } = applyMove(maze, state, dir);

            // Derived from the fixture, not read back off the delta: where
            // the runner stood, where they ended up, and the one edge between
            // them, each in the start-relative frame.
            const permitted = new Set([
              relCell(before),
              relCell(next.at),
              relEdge(edgeBetween(before, dir)),
            ]);

            expect(Object.keys(delta).sort()).toEqual(
              Object.keys(delta)
                .filter((field) => DELTA_FIELDS.includes(field))
                .sort(),
            );
            for (const mentioned of coordinatesIn(delta)) {
              expect(permitted).toContain(mentioned);
            }
            // The sealed key and the gated treasure are unreachable, so no
            // delta may ever carry their contents.
            expect(delta.revealedCell?.key).toBeUndefined();
            expect(delta.revealedCell?.treasure).toBeUndefined();

            state = next;
          }
        },
      ),
    );
  });
});
