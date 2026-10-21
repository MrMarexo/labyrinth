import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Direction, Orientation, Point } from "~/maze/format";
import {
  cellKey,
  edgeBetween,
  edgeKey,
  isInteriorEdge,
  outlineEdges,
  step,
} from "~/maze/geometry";

/** N<->S and E<->W are the only pairs; used to re-cross an edge from the far side. */
function opposite(dir: Direction): Direction {
  switch (dir) {
    case "N":
      return "S";
    case "S":
      return "N";
    case "E":
      return "W";
    case "W":
      return "E";
  }
}

describe("step and edgeBetween", () => {
  // Values worked out by hand from spec §3.1 ("H" at (x,y) is the edge between
  // (x,y) and (x,y+1); "V" at (x,y) is the edge between (x,y) and (x+1,y)),
  // not read off the implementation. N and W name the cell they enter; S and
  // E name the cell they leave — the edge always belongs to the lower-
  // coordinate side.
  const origin: Point = { x: 3, y: 4 };

  it("steps and names the edge north", () => {
    expect(step(origin, "N")).toEqual({ x: 3, y: 3 });
    expect(edgeBetween(origin, "N")).toEqual({ o: "H", x: 3, y: 3 });
  });

  it("steps and names the edge south", () => {
    expect(step(origin, "S")).toEqual({ x: 3, y: 5 });
    expect(edgeBetween(origin, "S")).toEqual({ o: "H", x: 3, y: 4 });
  });

  it("steps and names the edge west", () => {
    expect(step(origin, "W")).toEqual({ x: 2, y: 4 });
    expect(edgeBetween(origin, "W")).toEqual({ o: "V", x: 2, y: 4 });
  });

  it("steps and names the edge east", () => {
    expect(step(origin, "E")).toEqual({ x: 4, y: 4 });
    expect(edgeBetween(origin, "E")).toEqual({ o: "V", x: 3, y: 4 });
  });

  // Catches a single-direction sign flip: an edge must be the same edge seen
  // from either side, so flipping just one direction's offset makes the two
  // views disagree. It does NOT catch a globally mirrored convention (e.g.
  // treating y as increasing upward throughout) — that would satisfy this
  // property perfectly while disagreeing with the spec. Closing that gap is
  // what the literal, spec-derived assertions above are for; this property
  // is strong only in combination with them, not on its own.
  it("agrees with the opposite direction from across the edge", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.constantFrom<Direction>("N", "S", "E", "W"),
        (x, y, dir) => {
          const p = { x, y };
          const here = edgeBetween(p, dir);
          const there = edgeBetween(step(p, dir), opposite(dir));
          expect(edgeKey(here)).toBe(edgeKey(there));
        },
      ),
    );
  });
});

describe("cellKey and edgeKey", () => {
  it("gives different cells different keys", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        (ax, ay, bx, by) => {
          fc.pre(ax !== bx || ay !== by);
          expect(cellKey({ x: ax, y: ay })).not.toBe(cellKey({ x: bx, y: by }));
        },
      ),
    );
  });

  it("gives different edges different keys", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Orientation>("H", "V"),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.constantFrom<Orientation>("H", "V"),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        (ao, ax, ay, bo, bx, by) => {
          fc.pre(ao !== bo || ax !== bx || ay !== by);
          expect(edgeKey({ o: ao, x: ax, y: ay })).not.toBe(
            edgeKey({ o: bo, x: bx, y: by }),
          );
        },
      ),
    );
  });

  it("gives an H edge and a V edge at the same coordinates different keys", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        (x, y) => {
          expect(edgeKey({ o: "H", x, y })).not.toBe(edgeKey({ o: "V", x, y }));
        },
      ),
    );
  });
});

describe("outlineEdges", () => {
  const keys = (cells: Point[]) => outlineEdges(cells).map(edgeKey).sort();

  it("draws four edges around a single square, including the frame border", () => {
    expect(keys([{ x: 0, y: 0 }])).toEqual(
      ["H:0,-1", "H:0,0", "V:-1,0", "V:0,0"].sort(),
    );
  });

  it("draws six edges around two adjacent squares, and not the one between them", () => {
    const outline = keys([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(outline).toHaveLength(6);
    expect(outline).not.toContain("V:0,0");
  });

  it("follows an L-shape", () => {
    expect(
      keys([
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toEqual(
      [
        "H:0,-1",
        "V:-1,0",
        "V:0,0",
        "V:-1,1",
        "H:0,1",
        "H:1,0",
        "V:1,1",
        "H:1,1",
      ].sort(),
    );
  });

  it("outlines an unpainted hole inside the shape as well as the outside", () => {
    const ring: Point[] = [];
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        if (x !== 1 || y !== 1) ring.push({ x, y });
      }
    }
    const outline = keys(ring);
    expect(outline).toHaveLength(16);
    for (const inner of ["H:1,0", "H:1,1", "V:0,1", "V:1,1"]) {
      expect(outline).toContain(inner);
    }
  });

  it("names each outline edge once, and each has exactly one painted side", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            x: fc.integer({ min: 0, max: 5 }),
            y: fc.integer({ min: 0, max: 5 }),
          }),
          { selector: cellKey, maxLength: 36 },
        ),
        (cells) => {
          const painted = new Set(cells.map(cellKey));
          const outline = outlineEdges(cells);
          const names = outline.map(edgeKey);
          expect(new Set(names).size).toBe(names.length);
          for (const edge of outline) {
            const here = cellKey({ x: edge.x, y: edge.y });
            const there = cellKey(
              edge.o === "H"
                ? { x: edge.x, y: edge.y + 1 }
                : { x: edge.x + 1, y: edge.y },
            );
            expect(painted.has(here) !== painted.has(there)).toBe(true);
            expect(isInteriorEdge(edge, painted)).toBe(false);
          }
        },
      ),
    );
  });
});

describe("isInteriorEdge", () => {
  const painted = new Set(["0,0", "1,0", "0,1"]);

  it("is true only when both sides are painted", () => {
    expect(isInteriorEdge({ o: "V", x: 0, y: 0 }, painted)).toBe(true);
    expect(isInteriorEdge({ o: "H", x: 0, y: 0 }, painted)).toBe(true);
    expect(isInteriorEdge({ o: "H", x: 1, y: 0 }, painted)).toBe(false);
    expect(isInteriorEdge({ o: "H", x: 0, y: -1 }, painted)).toBe(false);
  });
});
