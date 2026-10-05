import type { DraftMaze } from "~/maze";

/**
 * An open square labyrinth with no walls and no gates, start in one corner
 * and treasure in the opposite one.
 *
 * It exists for seeding — the test-only router uses it so a Playwright spec
 * does not have to click seventy-two cells to reach the part it is actually
 * testing, and the integration fixtures re-export it so there is one
 * definition rather than two that drift.
 *
 * Every entry in CELL_COUNT_PRESETS is a perfect square (36, 64, 100, 144),
 * which is what makes the optimal move count checkable by hand: with no
 * blockers it is the plain Manhattan distance between opposite corners.
 */
export function openMazeDraft(cellCount: number): DraftMaze {
  const side = sideOf(cellCount);
  const cells = [];
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) cells.push({ x, y });
  }
  return {
    version: 1,
    cells,
    start: { x: 0, y: 0 },
    treasure: { x: side - 1, y: side - 1 },
    segments: [],
    keys: [],
  };
}

export function openMazeOptimalMoves(cellCount: number): number {
  return 2 * (sideOf(cellCount) - 1);
}

function sideOf(cellCount: number): number {
  const side = Math.round(Math.sqrt(cellCount));
  if (side * side !== cellCount) {
    throw new Error(
      `openMaze needs a perfect square cell count, got ${cellCount}`,
    );
  }
  return side;
}
