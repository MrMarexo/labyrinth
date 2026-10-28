import { describe, expect, it } from "vitest";

import { PIXEL_MAPS, runsPath } from "~/components/pixel-maps";

describe("pixel glyph maps", () => {
  it.each(Object.entries(PIXEL_MAPS))(
    "%s is a rectangle of known pixels",
    (_, map) => {
      const width = map[0]!.length;
      for (const row of map) {
        expect(row).toHaveLength(width);
        expect(row).toMatch(/^[#+.]+$/);
      }
    },
  );
});

describe("runsPath", () => {
  it("draws each horizontal run as one rectangle", () => {
    expect(runsPath(["##.#", ".##."], "#")).toBe(
      "M0 0h2v1h-2zM3 0h1v1h-1zM1 1h2v1h-2z",
    );
  });

  it("is empty when the map has none of the pixel", () => {
    expect(runsPath(["#.", ".#"], "+")).toBe("");
  });
});
