import { describe, expect, it } from "vitest";

import { openMazeDraft, openMazeOptimalMoves } from "~/lib/open-maze";
import { CELL_COUNT_PRESETS, validateMaze } from "~/maze";

describe("openMazeDraft", () => {
  it.each(CELL_COUNT_PRESETS)(
    "produces a maze that validates at %i cells",
    (cellCount) => {
      const result = validateMaze(openMazeDraft(cellCount), {
        cellCount,
        gateCount: 0,
      });
      expect(result.ok).toBe(true);
    },
  );

  it.each(CELL_COUNT_PRESETS)(
    "solves in the hand-derived number of moves at %i cells",
    (cellCount) => {
      const result = validateMaze(openMazeDraft(cellCount), {
        cellCount,
        gateCount: 0,
      });
      // An open square with the start and the treasure at opposite corners:
      // the shortest route is the Manhattan distance, 2 * (side - 1).
      const side = Math.sqrt(cellCount);
      expect(result.ok && result.optimalMoves).toBe(2 * (side - 1));
      expect(openMazeOptimalMoves(cellCount)).toBe(2 * (side - 1));
    },
  );

  it("refuses a cell count that is not a perfect square", () => {
    expect(() => openMazeDraft(37)).toThrow();
  });
});
