import type { DraftMaze } from "~/maze";

/**
 * A 6x6 labyrinth with no walls or gates: every one of its 36 cells is open,
 * so the shortest route from corner to corner is the plain Manhattan
 * distance, 5 + 5 = 10 moves — the one shape whose optimal move count can be
 * checked by hand rather than trusted to the solver. Shared across tests so
 * anything that needs a maze known to validate and solve to a specific
 * number (Phase 3's match setup included) can reuse this one.
 */
export const SOLVABLE_MAZE_CELL_COUNT = 36;
export const SOLVABLE_MAZE_GATE_COUNT = 0;
export const SOLVABLE_MAZE_OPTIMAL_MOVES = 10;

export function solvableDraft(): DraftMaze {
  const cells = [];
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 6; x += 1) cells.push({ x, y });
  }
  return {
    version: 1,
    cells,
    start: { x: 0, y: 0 },
    treasure: { x: 5, y: 5 },
    segments: [],
    keys: [],
  };
}
