import type { MatchStatus } from "./status";

/**
 * Whether the editor may offer "Use in this match" (spec §10.2): the match
 * is still in `drawing`, the caller has not submitted yet, and the maze was
 * drawn at the match's own settings. `submitMaze` still decides for real;
 * this only keeps the editor from offering a button that would be refused.
 */
export function mayUseInMatch(
  match: {
    status: MatchStatus;
    cellCount: number;
    gateCount: number;
    you: { hasSubmitted: boolean };
  },
  maze: { cellCount: number; gateCount: number },
): boolean {
  return (
    match.status === "drawing" &&
    !match.you.hasSubmitted &&
    match.cellCount === maze.cellCount &&
    match.gateCount === maze.gateCount
  );
}
