import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Maze } from "~/maze/format";
import { canonicalString, contentHash, normalize } from "~/maze/normalize";

const maze: Maze = {
  version: 1,
  cells: [
    { x: 3, y: 2 },
    { x: 4, y: 2 },
    { x: 3, y: 3 },
  ],
  start: { x: 3, y: 2 },
  treasure: { x: 3, y: 3 },
  segments: [{ o: "V", x: 3, y: 2, kind: "wall" }],
  keys: [],
};

/** Moves every coordinate by (dx, dy) without changing the maze's meaning. */
function translate(m: Maze, dx: number, dy: number): Maze {
  const move = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...m,
    cells: m.cells.map(move),
    start: move(m.start),
    treasure: move(m.treasure),
    segments: m.segments.map((s) => ({ ...s, ...move(s) })),
    keys: m.keys.map((k) => ({ ...k, ...move(k) })),
  };
}

describe("normalize", () => {
  it("translates the shape so its bounding box starts at the origin", () => {
    const n = normalize(maze);
    expect(Math.min(...n.cells.map((c) => c.x))).toBe(0);
    expect(Math.min(...n.cells.map((c) => c.y))).toBe(0);
    expect(n.start).toEqual({ x: 0, y: 0 });
    expect(n.treasure).toEqual({ x: 0, y: 1 });
  });

  it("orders cells, segments and keys deterministically", () => {
    const shuffled: Maze = {
      ...maze,
      cells: [maze.cells[2]!, maze.cells[0]!, maze.cells[1]!],
    };
    expect(canonicalString(normalize(shuffled))).toBe(
      canonicalString(normalize(maze)),
    );
  });
});

describe("contentHash", () => {
  it("is stable under translation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 12 }),
        (dx, dy) => {
          expect(contentHash(translate(maze, dx, dy))).toBe(contentHash(maze));
        },
      ),
    );
  });

  it("is stable under reordering", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(maze.cells, { minLength: 3 }),
        (cells) => {
          expect(contentHash({ ...maze, cells })).toBe(contentHash(maze));
        },
      ),
    );
  });

  it("changes when a wall moves", () => {
    const moved: Maze = {
      ...maze,
      segments: [{ o: "H", x: 3, y: 2, kind: "wall" }],
    };
    expect(contentHash(moved)).not.toBe(contentHash(maze));
  });

  it("changes when a wall becomes a gate", () => {
    const gated: Maze = {
      ...maze,
      segments: [{ o: "V", x: 3, y: 2, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 4, y: 2 }],
    };
    expect(contentHash(gated)).not.toBe(contentHash(maze));
  });

  it("is a fixed-width lowercase hex string", () => {
    expect(contentHash(maze)).toMatch(/^[0-9a-f]{16}$/);
  });
});
