import { describe, expect, it } from "vitest";

import { contentHash, type Maze, validateMaze } from "~/maze";

const corridor = {
  version: 1,
  cells: [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 7, y: 5 },
  ],
  start: { x: 5, y: 5 },
  treasure: { x: 7, y: 5 },
  segments: [],
  keys: [],
};

const settings = { cellCount: 3, gateCount: 0 };

describe("validateMaze", () => {
  it("accepts a valid maze and returns its derived metrics", () => {
    const result = validateMaze(corridor, settings);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.optimalMoves).toBe(2);
      expect(result.contentHash).toMatch(/^[0-9a-f]{16}$/);
      // The stored maze is normalized, so its origin is (0,0).
      expect(result.maze.start).toEqual({ x: 0, y: 0 });
    }
  });

  it("stops at the shape pass when the input is not a maze", () => {
    const result = validateMaze({ nope: true }, settings);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it("reports structural problems without attempting a search", () => {
    const result = validateMaze(corridor, { cellCount: 36, gateCount: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toEqual([
        "maze.validate.wrongCellCount",
      ]);
    }
  });

  it("reports an unreachable treasure", () => {
    const walled = {
      ...corridor,
      segments: [{ o: "V", x: 5, y: 5, kind: "wall" }],
    };
    const result = validateMaze(walled, settings);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toContain(
        "maze.validate.treasureUnreachable",
      );
    }
  });

  it("gives an identical hash for the same maze drawn elsewhere", () => {
    const moved = {
      ...corridor,
      cells: corridor.cells.map((c) => ({ x: c.x - 5, y: c.y - 5 })),
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
    };
    const a = validateMaze(corridor, settings);
    const b = validateMaze(moved, settings);
    expect(a.ok && b.ok && a.contentHash === b.contentHash).toBe(true);
  });
});

describe("contentHash", () => {
  // Task 3's review found that `bySegment` (src/maze/normalize.ts) had never
  // been executed by any test: every fixture up to that point had at most one
  // segment, and Array.prototype.sort never calls a comparator on an array of
  // length <= 1. This fixture has three, spanning both orientations and both
  // kinds, so the two segment arrays below are genuinely out of each other's
  // order and only a working comparator makes their hashes agree.
  const base: Maze = {
    version: 1,
    cells: [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 5, y: 6 },
    ],
    start: { x: 5, y: 5 },
    treasure: { x: 6, y: 5 },
    segments: [
      { o: "H", x: 5, y: 5, kind: "wall" },
      { o: "H", x: 5, y: 6, kind: "gate", gate: 1 },
      { o: "V", x: 6, y: 5, kind: "wall" },
    ],
    keys: [{ gate: 1, x: 5, y: 6 }],
  };

  const reordered: Maze = {
    ...base,
    segments: [base.segments[2]!, base.segments[1]!, base.segments[0]!],
  };

  it("is identical for mazes differing only in segment order", () => {
    expect(contentHash(reordered)).toBe(contentHash(base));
  });
});

describe("contentHash, key order", () => {
  // `byKey` had the identical hole Task 3's review found in `bySegment`: every
  // fixture that reached `normalize` carried zero or one key, and
  // Array.prototype.sort never calls a comparator on an array of length <= 1,
  // so `byKey` had never executed. It was also not a total order — it compared
  // `gate` with no tiebreak, unlike `bySegment`.
  const base: Maze = {
    version: 1,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
    start: { x: 0, y: 0 },
    treasure: { x: 2, y: 0 },
    segments: [
      { o: "V", x: 0, y: 0, kind: "gate", gate: 2 },
      { o: "V", x: 1, y: 0, kind: "gate", gate: 1 },
    ],
    keys: [
      { gate: 2, x: 1, y: 0 },
      { gate: 1, x: 2, y: 0 },
    ],
  };

  it("is identical for mazes differing only in key order", () => {
    const reordered: Maze = { ...base, keys: [base.keys[1]!, base.keys[0]!] };
    expect(contentHash(reordered)).toBe(contentHash(base));
  });

  it("is identical for two keys on one gate differing only in position", () => {
    // Two keys for one gate is invalid, and `normalize` does not validate —
    // the same reason `bySegment` carries a kind tiebreak. Without the
    // position tiebreak the comparator returns 0 for this pair, the stable
    // sort leaves them in arrival order, and the two hashes disagree.
    const shared: Maze = {
      ...base,
      keys: [
        { gate: 1, x: 1, y: 0 },
        { gate: 1, x: 2, y: 0 },
      ],
    };
    const swapped: Maze = {
      ...shared,
      keys: [shared.keys[1]!, shared.keys[0]!],
    };
    expect(contentHash(swapped)).toBe(contentHash(shared));
  });
});
