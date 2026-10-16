import type { Direction, DraftMaze } from "~/maze";

/**
 * Seed labyrinths for tests. One is an open square labyrinth with no walls
 * and no gates; the other is a gated one with a wall, a gate and a key.
 *
 * They exist for seeding — the test-only router uses them so a Playwright
 * spec does not have to click seventy-two cells to reach the part it is
 * actually testing, and the integration fixtures re-export them so there is
 * one definition rather than two that drift.
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

export const GATED_MAZE_CELL_COUNT = 36;
export const GATED_MAZE_GATE_COUNT = 1;

/**
 * The open 6×6 labyrinth with a wall across it under row 2, gate 1 in that
 * wall at the far east end, and its key at the west end of row 2. It is the
 * smallest seed with something to bump, something to collect and something
 * to open, which is what the run's end-to-end spec walks through (spec §12).
 * `GATED_MAZE_ROUTE` solves it.
 */
export function gatedMazeDraft(): DraftMaze {
  const open = openMazeDraft(GATED_MAZE_CELL_COUNT);
  return {
    ...open,
    segments: [
      ...[0, 1, 2, 3, 4].map((x) => ({
        o: "H" as const,
        x,
        y: 2,
        kind: "wall" as const,
      })),
      { o: "H", x: 5, y: 2, kind: "gate", gate: 1 },
    ],
    keys: [{ gate: 1, x: 0, y: 2 }],
  };
}

/** S, S onto the key, S into the wall, east along row 2, S through the gate to the treasure. */
export const GATED_MAZE_ROUTE: readonly Direction[] = [
  "S",
  "S",
  "S",
  "E",
  "E",
  "E",
  "E",
  "E",
  "S",
  "S",
  "S",
];
