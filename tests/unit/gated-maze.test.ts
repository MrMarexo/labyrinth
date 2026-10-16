import { describe, expect, it } from "vitest";

import {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  GATED_MAZE_ROUTE,
  gatedMazeDraft,
} from "~/lib/open-maze";
import { advanceRun, freshRun, mazeSchema, validateMaze } from "~/maze";

describe("gatedMazeDraft", () => {
  it("validates at its own settings", () => {
    const result = validateMaze(gatedMazeDraft(), {
      cellCount: GATED_MAZE_CELL_COUNT,
      gateCount: GATED_MAZE_GATE_COUNT,
    });
    expect(result.ok).toBe(true);
  });

  it("is solved by its route with one wall bump, a key and the gate", () => {
    const maze = mazeSchema.parse(gatedMazeDraft());
    let run = freshRun(maze);
    const outcomes = [];
    for (const dir of GATED_MAZE_ROUTE) {
      const step = advanceRun(run, maze, dir);
      run = step.run;
      outcomes.push(step.outcome);
    }
    expect(outcomes).toEqual([
      "moved",
      "moved_found_key",
      "blocked_wall",
      "moved",
      "moved",
      "moved",
      "moved",
      "moved",
      "moved_through_gate",
      "moved",
      "moved_found_treasure",
    ]);
    expect(run.state.penalties).toBe(1);
    expect(run.state.moves).toBe(11);
  });
});
