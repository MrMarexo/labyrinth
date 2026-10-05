import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DIRECTIONS, type Maze } from "~/maze/format";
import { applyMove, initialRunState } from "~/maze/reduce";

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
      ...pair(),
      segments: [{ o: "H", x: 0, y: 0, kind: "gate", gate: 2 }],
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
  });

  it("refuses to move once the run has finished", () => {
    const maze = pair();
    const finished = { ...initialRunState(maze), finished: true };
    const { state, outcome } = applyMove(maze, finished, "E");
    expect(outcome).toBe("blocked_wall");
    expect(state).toEqual(finished);
  });
});

describe("the runner cannot tell a void square from a wall", () => {
  it("produces byte-identical deltas for both", () => {
    // Spec §2.2 and invariant 6: this is the difference between a hidden maze
    // and a guessable one. Walking west off the shape and walking east into a
    // wall must look exactly the same to the runner.
    const walled = pair();
    walled.segments = [{ o: "V", x: 0, y: 0, kind: "wall" }];
    const intoWall = applyMove(walled, initialRunState(walled), "E");

    const open = pair();
    const offShape = applyMove(open, initialRunState(open), "W");

    // Normalise the two edges they bumped, since those legitimately differ.
    const strip = (d: typeof intoWall.delta) => ({
      ...d,
      revealedSegment: d.revealedSegment
        ? { kind: d.revealedSegment.kind }
        : undefined,
    });

    expect(JSON.stringify(strip(offShape.delta))).toBe(
      JSON.stringify(strip(intoWall.delta)),
    );
    expect(offShape.delta.outcome).toBe(intoWall.delta.outcome);
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

  it("never reveals a cell the runner did not enter", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...DIRECTIONS), { maxLength: 40 }),
        (dirs) => {
          let state = initialRunState(maze);
          for (const dir of dirs) {
            const { state: next, delta } = applyMove(maze, state, dir);
            if (delta.revealedCell) {
              expect(delta.revealedCell).toMatchObject({
                x: next.at.x,
                y: next.at.y,
              });
            }
            state = next;
          }
        },
      ),
    );
  });
});
