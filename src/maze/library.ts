/** How many labyrinths a player may keep, counting every state. */
export const MAZE_LIMIT = 10;

/**
 * Where a labyrinth stands in its author's library. Derived, never stored:
 * a draft becomes ready the moment `saveDraft` finds it valid and records a
 * `contentHash`, and used the moment it is submitted to a match.
 */
export type MazeState = "draft" | "ready" | "used";

export function mazeState(m: {
  status: "draft" | "submitted";
  contentHash: string | null;
}): MazeState {
  if (m.status === "submitted") return "used";
  return m.contentHash === null ? "draft" : "ready";
}
