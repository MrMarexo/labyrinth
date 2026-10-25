import { describe, expect, it } from "vitest";

import { centreOn, clampCamera, follow, framePainted } from "~/lib/camera";

const bounds = { minX: 0, minY: 0, maxX: 32, maxY: 32 };

describe("clampCamera", () => {
  it("keeps a camera that already fits", () => {
    expect(clampCamera({ x: 4, y: 6 }, 16, bounds)).toEqual({ x: 4, y: 6 });
  });

  it("pulls a camera back inside the bounds on each side", () => {
    expect(clampCamera({ x: -3, y: 20 }, 16, bounds)).toEqual({ x: 0, y: 16 });
  });

  it("centres the view on bounds smaller than the span", () => {
    const small = { minX: 2, minY: 0, maxX: 6, maxY: 32 };
    expect(clampCamera({ x: 10, y: 0 }, 16, small)).toEqual({ x: -4, y: 0 });
  });
});

describe("centreOn", () => {
  it("puts the middle of the cell in the middle of the view", () => {
    expect(centreOn({ x: 10, y: 3 }, 16)).toEqual({ x: 2.5, y: -4.5 });
  });
});

describe("follow", () => {
  it("does not move while the cell is clear of the margin", () => {
    const cam = { x: 0, y: 0 };
    expect(follow(cam, { x: 8, y: 8 }, 16, 2)).toBe(cam);
  });

  it("shifts just enough to keep the margin", () => {
    // Cell 14 ends at 15; with a margin of 2 the view must end at 17.
    expect(follow({ x: 0, y: 0 }, { x: 14, y: 1 }, 16, 2)).toEqual({
      x: 1,
      y: -1,
    });
  });

  it("centres on a cell outside the view", () => {
    expect(follow({ x: 0, y: 0 }, { x: 30, y: 4 }, 16, 2)).toEqual(
      centreOn({ x: 30, y: 4 }, 16),
    );
  });
});

describe("framePainted", () => {
  it("starts in the middle of an empty frame", () => {
    expect(framePainted([], 16, bounds)).toEqual({ x: 8, y: 8 });
  });

  it("centres on the painted squares, kept inside the frame", () => {
    const cells = [
      { x: 20, y: 28 },
      { x: 25, y: 31 },
    ];
    // Centre (23, 30) would put the view at (15, 22); the frame ends at 32.
    expect(framePainted(cells, 16, bounds)).toEqual({ x: 15, y: 16 });
  });
});

describe("a window wider than it is tall", () => {
  const span = { w: 24, h: 16 };

  it("clamps each axis to its own span", () => {
    expect(clampCamera({ x: 20, y: 20 }, span, bounds)).toEqual({
      x: 8,
      y: 16,
    });
  });

  it("follows on each axis by its own span", () => {
    expect(follow({ x: 0, y: 0 }, { x: 22, y: 14 }, span, 1)).toEqual({
      x: 0,
      y: 0,
    });
    expect(follow({ x: 0, y: 0 }, { x: 23, y: 15 }, span, 1)).toEqual({
      x: 1,
      y: 1,
    });
  });

  it("opens an empty frame on its middle", () => {
    expect(framePainted([], span, bounds)).toEqual({ x: 4, y: 8 });
  });
});
