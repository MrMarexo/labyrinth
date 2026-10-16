import { openMazeDraft, openMazeOptimalMoves } from "~/lib/open-maze";
import type { DraftMaze } from "~/maze";

/**
 * A 6x6 labyrinth with no walls or gates: every one of its 36 cells is open,
 * so the shortest route from corner to corner is the plain Manhattan
 * distance, 5 + 5 = 10 moves. Shared across tests so anything that needs a
 * maze known to validate and solve to a specific number can reuse this one.
 *
 * The shape itself comes from `~/lib/open-maze`, which is also what the
 * test-only seeding procedure uses — one generator, so a change to it
 * cannot leave the integration fixtures and the e2e seeds disagreeing.
 */
export const SOLVABLE_MAZE_CELL_COUNT = 36;
export const SOLVABLE_MAZE_GATE_COUNT = 0;
export const SOLVABLE_MAZE_OPTIMAL_MOVES = openMazeOptimalMoves(
  SOLVABLE_MAZE_CELL_COUNT,
);

export function solvableDraft(): DraftMaze {
  return openMazeDraft(SOLVABLE_MAZE_CELL_COUNT);
}

export {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  GATED_MAZE_ROUTE,
  gatedMazeDraft,
} from "~/lib/open-maze";
