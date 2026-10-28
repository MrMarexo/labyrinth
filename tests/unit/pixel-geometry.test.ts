import { describe, expect, it } from "vitest";

import { pixelWalls, tilesPath } from "~/components/pixel-geometry";
import type { Edge } from "~/maze";

const wall = (o: "H" | "V", x: number, y: number): Edge =>
  ({ o, x, y, kind: "wall" }) as Edge;

describe("pixelWalls", () => {
  // An L: the bottom of (0,0) runs (0,1)→(1,1); the right of (0,1) runs
  // (1,1)→(1,2).
  const bottom = wall("H", 0, 0);
  const right = wall("V", 0, 1);

  it("steps a right-angle corner in twice", () => {
    const { line, corners } = pixelWalls([bottom, right], 40, 4);
    // Both walls end two widths short of the shared point (40, 40).
    expect(line(bottom)).toEqual({ x1: 0, y1: 40, x2: 32, y2: 40 });
    expect(line(right)).toEqual({ x1: 40, y1: 48, x2: 40, y2: 80 });
    // One pixel inside the bend, diagonal from both.
    expect(corners).toEqual([{ x: 34, y: 42, width: 4, height: 4 }]);
  });

  it("leaves straight runs, T-junctions and loose ends alone", () => {
    const straight = [wall("H", 0, 0), wall("H", 1, 0)];
    expect(pixelWalls(straight, 40, 4).corners).toEqual([]);
    expect(pixelWalls(straight, 40, 4).line(straight[0]!)).toEqual({
      x1: 0,
      y1: 40,
      x2: 40,
      y2: 40,
    });

    const tee = [...straight, wall("V", 0, 1)];
    expect(pixelWalls(tee, 40, 4).corners).toEqual([]);
  });

  it("draws a wall it was not given straight", () => {
    const { line } = pixelWalls([], 40, 4);
    expect(line(right)).toEqual({ x1: 40, y1: 40, x2: 40, y2: 80 });
  });
});

describe("tilesPath", () => {
  it("draws one closed tile per square, inset by half the gap", () => {
    const d = tilesPath(
      [
        { x: 0, y: 0 },
        { x: 2, y: 1 },
      ],
      40,
      2,
      4,
    );
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/z/g)).toHaveLength(2);
    expect(d.startsWith("M5 1")).toBe(true);
    expect(d).toContain("M85 41");
  });
});
