import type { TranslatableIssue } from "~/lib/issues";
import { parseMaze, type Maze } from "./format";
import { contentHash, normalize } from "./normalize";
import { solve } from "./solve";
import {
  validateStructure,
  type MazeIssueKey,
  type MazeSettings,
} from "./validate";

export * from "./format";
export * from "./geometry";
export * from "./normalize";
export * from "./reduce";
export * from "./solve";
export * from "./validate";

export type MazeValidation =
  | { ok: true; maze: Maze; contentHash: string; optimalMoves: number }
  | { ok: false; issues: TranslatableIssue[] };

/**
 * The single call that turns untrusted input into either a storable maze with
 * its derived metrics, or every reason it was rejected.
 *
 * Three passes, and the order matters: a solvability search over a
 * structurally broken maze would be meaningless, and a structural check over
 * something that is not even shaped like a maze would be noise.
 */
export function validateMaze(
  input: unknown,
  settings: MazeSettings,
): MazeValidation {
  const parsed = parseMaze(input);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };

  const structural = validateStructure(parsed.maze, settings);
  if (structural.length > 0) return { ok: false, issues: structural };

  const solution = solve(parsed.maze);
  if (!solution.solvable || solution.optimalMoves === null) {
    const unreachable: MazeIssueKey = "maze.validate.treasureUnreachable";
    return { ok: false, issues: [{ key: unreachable }] };
  }

  // Normalized once and reused: `contentHash` is defined over the normalized
  // form anyway, and normalizing the same input twice invites the two copies
  // to drift apart under a future edit.
  const normalized = normalize(parsed.maze);

  return {
    ok: true,
    maze: normalized,
    contentHash: contentHash(normalized),
    optimalMoves: solution.optimalMoves,
  };
}
