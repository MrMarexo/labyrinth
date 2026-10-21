import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  cellUnder,
  cellsBetween,
  nearestInteriorEdge,
  samplesBetween,
} from "~/components/editor/hit-test";

// Every coordinate here is in cell units: (2.5, 2.5) is the centre of (2,2).

describe("cellUnder", () => {
  it("floors to the containing square", () => {
    expect(cellUnder({ x: 2.99, y: 0 })).toEqual({ x: 2, y: 0 });
    expect(cellUnder({ x: 3, y: 1.5 })).toEqual({ x: 3, y: 1 });
  });
});

describe("nearestInteriorEdge", () => {
  const column = new Set(["2,1", "2,2", "2,3"]);
  const row = new Set(["1,2", "2,2", "3,2"]);

  it("finds nothing in the middle of a square", () => {
    expect(nearestInteriorEdge({ x: 2.5, y: 2.5 }, column)).toBeNull();
  });

  it("finds the edge above, below, left and right when it is interior", () => {
    expect(nearestInteriorEdge({ x: 2.5, y: 2.1 }, column)).toEqual({
      o: "H",
      x: 2,
      y: 1,
    });
    expect(nearestInteriorEdge({ x: 2.5, y: 2.9 }, column)).toEqual({
      o: "H",
      x: 2,
      y: 2,
    });
    expect(nearestInteriorEdge({ x: 2.1, y: 2.5 }, row)).toEqual({
      o: "V",
      x: 1,
      y: 2,
    });
    expect(nearestInteriorEdge({ x: 2.9, y: 2.5 }, row)).toEqual({
      o: "V",
      x: 2,
      y: 2,
    });
  });

  it("never offers an outline edge", () => {
    // Left of (2,2) in a vertical column is the shape's own border.
    expect(nearestInteriorEdge({ x: 2.05, y: 2.5 }, column)).toBeNull();
  });

  it("ignores a point too far from every edge", () => {
    expect(nearestInteriorEdge({ x: 2.5, y: 2.4 }, column)).toBeNull();
  });

  it("ignores a point in a corner, where two edges are equally near", () => {
    const block = new Set(["1,1", "2,1", "1,2", "2,2"]);
    expect(nearestInteriorEdge({ x: 2.05, y: 2.05 }, block)).toBeNull();
  });
});

describe("cellsBetween", () => {
  it("covers every square of a straight run, both ends included", () => {
    expect(cellsBetween({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it("leaves no gap between consecutive squares, whatever the direction", () => {
    const point = fc.record({
      x: fc.integer({ min: -3, max: 18 }),
      y: fc.integer({ min: -3, max: 18 }),
    });
    fc.assert(
      fc.property(point, point, (a, b) => {
        const line = cellsBetween(a, b);
        expect(line[0]).toEqual(a);
        expect(line.at(-1)).toEqual(b);
        for (let i = 1; i < line.length; i += 1) {
          const dx = Math.abs(line[i]!.x - line[i - 1]!.x);
          const dy = Math.abs(line[i]!.y - line[i - 1]!.y);
          expect(Math.max(dx, dy)).toBe(1);
        }
      }),
    );
  });
});

describe("samplesBetween", () => {
  it("spaces samples no further apart than asked, ends included", () => {
    const coord = fc.double({ min: -2, max: 18, noNaN: true });
    fc.assert(
      fc.property(coord, coord, coord, coord, (ax, ay, bx, by) => {
        const a = { x: ax, y: ay };
        const b = { x: bx, y: by };
        const samples = samplesBetween(a, b, 0.25);
        expect(samples[0]).toEqual(a);
        expect(samples.at(-1)).toEqual(b);
        for (let i = 1; i < samples.length; i += 1) {
          const d = Math.hypot(
            samples[i]!.x - samples[i - 1]!.x,
            samples[i]!.y - samples[i - 1]!.y,
          );
          expect(d).toBeLessThanOrEqual(0.25 + 1e-9);
        }
      }),
    );
  });
});
