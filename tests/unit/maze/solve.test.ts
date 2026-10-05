import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Maze, Segment } from "~/maze/format";
import { canonicalString, normalize } from "~/maze/normalize";
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

/**
 * A gated fixture whose route needs the gate, the key and a reversal: east to
 * the junction (1,0), east again for key 1 at (2,0), back west, then south
 * twice through the now-open gate to the treasure. Five moves.
 *
 * Used by the invariance properties below, which an empty-`segments`,
 * empty-`keys` corridor cannot test: nothing that could be transformed
 * wrongly would be transformed at all.
 */
function gated(): Maze {
  return {
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
}

/** Slides every cell, edge and key by the same offset. */
function translate(maze: Maze, dx: number, dy: number): Maze {
  const move = <T extends { x: number; y: number }>(p: T): T => ({
    ...p,
    x: p.x + dx,
    y: p.y + dy,
  });
  return {
    ...maze,
    cells: maze.cells.map(move),
    start: move(maze.start),
    treasure: move(maze.treasure),
    segments: maze.segments.map(move),
    keys: maze.keys.map(move),
  };
}

/**
 * A quarter turn, with the edge remapping derived from spec §3.1 rather than
 * found by trial. With y increasing downward, (x, y) -> (-y, x) is a rigid
 * rotation, and §3.1 fixes what each edge address means:
 *
 *   H{x,y} joins (x,y) and (x,y+1). Their images are (-y,x) and (-y-1,x),
 *   horizontally adjacent with the smaller x at -y-1, so the image edge is
 *   V{-y-1, x}.
 *
 *   V{x,y} joins (x,y) and (x+1,y). Their images are (-y,x) and (-y,x+1),
 *   vertically adjacent with the smaller y at x, so the image edge is
 *   H{-y, x}.
 *
 * The result is then slid back to non-negative coordinates, which is a
 * translation and therefore invisible to the solver. A stored segment always
 * has both its cells painted, so after the slide no edge can land below zero.
 */
function rotate(maze: Maze): Maze {
  const turn = <T extends { x: number; y: number }>(p: T): T => ({
    ...p,
    x: -p.y,
    y: p.x,
  });
  const turnSegment = (s: Segment): Segment =>
    s.o === "H"
      ? { ...s, o: "V", x: -s.y - 1, y: s.x }
      : { ...s, o: "H", x: -s.y, y: s.x };

  const cells = maze.cells.map(turn);
  return translate(
    {
      ...maze,
      cells,
      start: turn(maze.start),
      treasure: turn(maze.treasure),
      segments: maze.segments.map(turnSegment),
      keys: maze.keys.map(turn),
    },
    -Math.min(...cells.map((c) => c.x)),
    -Math.min(...cells.map((c) => c.y)),
  );
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

  it("picks a key up in passing without lengthening the route", () => {
    // Corridor of 4 with a gate between (2,0) and (3,0). The key lies on the
    // way at (1,0), so the route is three moves east and no detour — the
    // point is that the solver picks the key up in passing rather than
    // treating the gate as impassable. The genuine detour is the next test.
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

  it("counts the detour to fetch a key off the direct route", () => {
    // The same corridor of 4 with the same gate, but key 1 now sits at the
    // bottom of a two-cell spur hanging off (1,0). The direct route is three
    // moves east; fetching the key costs four more:
    //
    //   E to (1,0), S to (1,1), S to (1,2) [key 1], N, N back to (1,0),
    //   E to (2,0), E through the gate to (3,0).
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 3, y: 0 },
      segments: [{ o: "V", x: 2, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 1, y: 2 }],
    };
    expect(solve(maze)).toEqual({ solvable: true, optimalMoves: 7 });
  });

  it("requires re-entering a junction with a different key set", () => {
    // (1,0) is a junction on the only route from start to treasure: east to
    // the junction, east again to collect key 1 at (2,0), back west through
    // the junction, then south through the now-open gate, then south again to
    // the treasure. The junction is visited twice — once holding no keys,
    // once holding key 1 — which is exactly the case a cell-only search gets
    // wrong: it marks (1,0) seen on the first pass and prunes the second,
    // so the gate is never reached and the maze is wrongly reported unsolvable.
    expect(solve(gated())).toEqual({ solvable: true, optimalMoves: 5 });
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
    // The gated fixture, not a bare corridor: a maze with no segments and no
    // keys has nothing a translation could get wrong, so the property would
    // hold whether or not `translate` moved them.
    const base = gated();
    expect(solve(base)).toEqual({ solvable: true, optimalMoves: 5 });

    // The fixture spans x 0..2 and y 0..2, so 13 is the largest offset that
    // stays inside the 0..MAX_BOUNDING_BOX-1 box the schema allows.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 13 }),
        fc.integer({ min: 0, max: 13 }),
        (dx, dy) => {
          expect(solve(translate(base, dx, dy))).toEqual({
            solvable: true,
            optimalMoves: 5,
          });
        },
      ),
    );
  });

  it("gives the same verdict however the maze is turned", () => {
    // Spec §12. Rotation is the case translation cannot cover: it is the only
    // transform that exchanges H and V edges, so it is the one that would
    // catch an asymmetric edge convention.
    const base = gated();
    let turned = base;
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      turned = rotate(turned);
      expect(solve(turned)).toEqual({ solvable: true, optimalMoves: 5 });
    }
    // Four quarter turns are the identity. If this fails, `rotate` is losing
    // something and the three assertions above prove less than they look.
    expect(canonicalString(normalize(turned))).toBe(
      canonicalString(normalize(base)),
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
