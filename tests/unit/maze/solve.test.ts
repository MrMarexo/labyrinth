import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Maze } from "~/maze/format";
import { solve } from "~/maze/solve";

/** A 1xN corridor from (0,0) to (n-1,0). */
function corridor(n: number): Maze {
  return {
    version: 1,
    cells: Array.from({ length: n }, (_, x) => ({ x, y: 0 })),
    start: { x: 0, y: 0 },
    treasure: { x: n - 1, y: 0 },
    segments: [],
    keys: [],
  };
}

describe("solve", () => {
  it("finds the straight-line route through a corridor", () => {
    expect(solve(corridor(5))).toEqual({ solvable: true, optimalMoves: 4 });
  });

  it("reports a treasure walled off from the start as unsolvable", () => {
    const maze = corridor(3);
    maze.segments = [{ o: "V", x: 1, y: 0, kind: "wall" }];
    expect(solve(maze)).toEqual({ solvable: false, optimalMoves: null });
  });

  it("counts the detour to fetch a key", () => {
    // Corridor of 4 with a gate between (2,0) and (3,0). The key lies on the
    // way at (1,0), so the route is three moves east and no detour — the
    // point is that the solver picks the key up in passing rather than
    // treating the gate as impassable.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 3, y: 0 },
      segments: [{ o: "V", x: 2, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 1, y: 0 }],
    };
    expect(solve(maze)).toEqual({ solvable: true, optimalMoves: 3 });
  });

  it("requires re-entering a junction with a different key set", () => {
    // (1,0) is a junction on the only route from start to treasure: east to
    // the junction, east again to collect key 1 at (2,0), back west through
    // the junction, then south through the now-open gate, then south again to
    // the treasure. The junction is visited twice — once holding no keys,
    // once holding key 1 — which is exactly the case a cell-only search gets
    // wrong: it marks (1,0) seen on the first pass and prunes the second,
    // so the gate is never reached and the maze is wrongly reported unsolvable.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 1, y: 2 },
      segments: [{ o: "H", x: 1, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 2, y: 0 }],
    };
    expect(solve(maze)).toEqual({ solvable: true, optimalMoves: 5 });
  });

  it("rejects a key locked behind its own gate", () => {
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
      segments: [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 1, y: 0 }],
    };
    expect(solve(maze).solvable).toBe(false);
  });

  it("accepts a decorative gate whose key is unreachable", () => {
    // Spec §4.2: misdirection is legal. The treasure is reachable without
    // ever opening gate 1, so the maze is valid even though gate 1 never can be.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 1, y: 0 },
      segments: [{ o: "H", x: 0, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 0, y: 1 }],
    };
    expect(solve(maze).solvable).toBe(true);
  });

  it("accepts a sealed pocket", () => {
    // (1,1) is walled off on both its open sides. Only the treasure must be
    // reachable, not every cell.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 1, y: 0 },
      segments: [
        { o: "H", x: 1, y: 0, kind: "wall" },
        { o: "V", x: 0, y: 1, kind: "wall" },
      ],
      keys: [],
    };
    expect(solve(maze).solvable).toBe(true);
  });

  it("treats a void square as solid", () => {
    // (1,0) is not painted, so there is no route from (0,0) to (2,0).
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
      segments: [],
      keys: [],
    };
    expect(solve(maze).solvable).toBe(false);
  });

  it("gives the same verdict wherever the maze sits on the canvas", () => {
    const base = corridor(4);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 12 }),
        (dx, dy) => {
          const moved: Maze = {
            ...base,
            cells: base.cells.map((c) => ({ x: c.x + dx, y: c.y + dy })),
            start: { x: base.start.x + dx, y: base.start.y + dy },
            treasure: { x: base.treasure.x + dx, y: base.treasure.y + dy },
          };
          expect(solve(moved)).toEqual(solve(base));
        },
      ),
    );
  });

  it("never reports a route shorter than the straight-line distance", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), (n) => {
        const result = solve(corridor(n));
        expect(result.optimalMoves).toBeGreaterThanOrEqual(n - 1);
      }),
    );
  });
});
