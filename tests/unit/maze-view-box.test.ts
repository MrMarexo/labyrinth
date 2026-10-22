import { describe, expect, it } from "vitest";

import { mazeViewBox } from "~/lib/maze-view-box";

describe("mazeViewBox", () => {
  it("frames the painted cells with half a cell of margin each side", () => {
    const cells = [
      { x: 2, y: 3 },
      { x: 4, y: 3 },
      { x: 3, y: 5 },
    ];
    // x 2..4 and y 3..5, so three cells each way plus one of margin.
    expect(mazeViewBox(cells, 40)).toBe("60 100 160 160");
  });

  it("frames a single cell", () => {
    expect(mazeViewBox([{ x: 0, y: 0 }], 10)).toBe("-5 -5 20 20");
  });

  it("falls back to one empty cell when nothing is painted", () => {
    expect(mazeViewBox([], 40)).toBe("0 0 40 40");
  });
});
