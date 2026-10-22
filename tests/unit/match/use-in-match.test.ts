import { describe, expect, it } from "vitest";

import { mayUseInMatch } from "~/match";

const match = {
  status: "drawing" as const,
  cellCount: 36,
  gateCount: 1,
  you: { hasSubmitted: false },
};
const maze = { cellCount: 36, gateCount: 1 };

describe("mayUseInMatch", () => {
  it("allows a maze at the match's settings while you are still drawing", () => {
    expect(mayUseInMatch(match, maze)).toBe(true);
  });

  it("refuses every status but drawing", () => {
    for (const status of [
      "awaiting_opponent",
      "running",
      "complete",
      "abandoned",
    ] as const) {
      expect(mayUseInMatch({ ...match, status }, maze)).toBe(false);
    }
  });

  it("refuses once you have submitted", () => {
    expect(mayUseInMatch({ ...match, you: { hasSubmitted: true } }, maze)).toBe(
      false,
    );
  });

  it("refuses a maze at other settings", () => {
    expect(mayUseInMatch(match, { ...maze, cellCount: 64 })).toBe(false);
    expect(mayUseInMatch(match, { ...maze, gateCount: 0 })).toBe(false);
  });
});
