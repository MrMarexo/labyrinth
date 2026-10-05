import { z } from "zod";

import {
  MAX_BOUNDING_BOX,
  MAX_GATES,
  mazeKeySchema,
  pointSchema,
  segmentSchema,
  type Maze,
} from "./format";

/** Every cell of the 16x16 frame, painted or not. */
const MAX_CELLS = MAX_BOUNDING_BOX * MAX_BOUNDING_BOX;
/** Every interior edge of the frame: FRAME*(FRAME-1) each for H and V. */
const MAX_SEGMENTS = 2 * MAX_BOUNDING_BOX * (MAX_BOUNDING_BOX - 1);

/**
 * A maze in progress. The only difference from `Maze` is that `start` and
 * `treasure` may be absent — an author who has painted ten cells has placed
 * neither, and that state must survive a page refresh (spec §10.2).
 *
 * A draft is permissive about completeness and never about the frame: the same
 * coordinate bounds apply, so a draft can never hold a cell the finished maze
 * could not.
 */
export const draftMazeSchema = z.object({
  version: z.literal(1),
  cells: z.array(pointSchema).max(MAX_CELLS),
  start: pointSchema.nullable(),
  treasure: pointSchema.nullable(),
  segments: z.array(segmentSchema).max(MAX_SEGMENTS),
  keys: z.array(mazeKeySchema).max(MAX_GATES),
});

export type DraftMaze = z.infer<typeof draftMazeSchema>;

export function emptyDraft(): DraftMaze {
  return {
    version: 1,
    cells: [],
    start: null,
    treasure: null,
    segments: [],
    keys: [],
  };
}

/** Emitted by the router and the editor when a draft has no start or
 * treasure yet — kept here since `draftToMaze` is what decides completeness. */
export const INCOMPLETE_DRAFT_KEY = "maze.validate.incomplete";

/**
 * Upgrades a draft to a `Maze`, or returns null when it is not yet complete.
 * This is a shape conversion only — it says nothing about whether the maze is
 * legal or solvable. `validateMaze` answers that.
 */
export function draftToMaze(draft: DraftMaze): Maze | null {
  if (draft.start === null || draft.treasure === null) return null;

  return {
    version: draft.version,
    cells: draft.cells,
    start: draft.start,
    treasure: draft.treasure,
    segments: draft.segments,
    keys: draft.keys,
  };
}
