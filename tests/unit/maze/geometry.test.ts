import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Direction, Orientation, Point } from "~/maze/format";
import { cellKey, edgeBetween, edgeKey, step } from "~/maze/geometry";

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

  // The strong check: an edge is the same edge seen from either side. This is
  // what would actually fail if one direction's offset had a flipped sign —
  // the two views of the same edge would stop agreeing.
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
