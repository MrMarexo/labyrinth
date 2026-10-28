/**
 * How many labyrinths a player may keep, counting every saved state. The
 * concept, the one labyrinth in progress, is not counted.
 */
export const MAZE_LIMIT = 10;

/** How many of these count toward `MAZE_LIMIT`. */
export function savedCount(mazes: readonly { state: MazeState }[]): number {
  return mazes.filter((m) => m.state !== "concept").length;
}

/**
 * Where a labyrinth stands in its author's library. Derived, never stored:
 * a concept is the one labyrinth in progress; it becomes ready when saved
 * (only a valid one can be). "draft" is a saved labyrinth that does not
 * validate, which only labyrinths saved before concepts existed can be.
 */
export type MazeState = "concept" | "draft" | "ready";

export function mazeState(m: {
  concept: boolean;
  contentHash: string | null;
}): MazeState {
  if (m.concept) return "concept";
  return m.contentHash === null ? "draft" : "ready";
}
