import { z } from "zod";

import { toTranslatableIssues, type TranslatableIssue } from "~/lib/issues";

/** Spec §3.3. The cap is set by what fits a desktop board, not by storage. */
export const MAX_BOUNDING_BOX = 16;

/** Spec §3.3. Keeps the solver's state space at cells × 2^8. */
export const MAX_GATES = 8;

/** Spec §3.3. The author paints exactly this many cells. */
export const CELL_COUNT_PRESETS = [36, 64, 100, 144] as const;
export type CellCount = (typeof CELL_COUNT_PRESETS)[number];

export const ORIENTATIONS = ["H", "V"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const DIRECTIONS = ["N", "E", "S", "W"] as const;
export type Direction = (typeof DIRECTIONS)[number];

const coordinate = z
  .number()
  .int({ message: "maze.format.coordinateNotAnInteger" })
  .min(0, { message: "maze.format.coordinateOutOfRange" })
  .max(MAX_BOUNDING_BOX - 1, { message: "maze.format.coordinateOutOfRange" });

const pointSchema = z.object({ x: coordinate, y: coordinate });
export type Point = z.infer<typeof pointSchema>;

const gateId = z
  .number()
  .int({ message: "maze.format.gateIdNotAnInteger" })
  .min(1, { message: "maze.format.gateIdOutOfRange" })
  .max(MAX_GATES, { message: "maze.format.gateIdOutOfRange" });

// Plain z.enum: an invalid orientation falls through to the generic
// `errors.validation.invalid` key, which is acceptable because the editor
// cannot produce one — only hand-edited or corrupted input can.
const orientation = z.enum(ORIENTATIONS);

const segmentSchema = z.discriminatedUnion("kind", [
  z.object({
    o: orientation,
    x: coordinate,
    y: coordinate,
    kind: z.literal("wall"),
  }),
  z.object({
    o: orientation,
    x: coordinate,
    y: coordinate,
    kind: z.literal("gate"),
    gate: gateId,
  }),
]);
export type Segment = z.infer<typeof segmentSchema>;

const keySchema = z.object({ gate: gateId, x: coordinate, y: coordinate });
export type MazeKey = z.infer<typeof keySchema>;

export const mazeSchema = z.object({
  // z.literal's `message` option is dropped for `invalid_literal` issues;
  // `errorMap` is the form zod actually honors here.
  version: z.literal(1, {
    errorMap: () => ({ message: "maze.format.unknownVersion" }),
  }),
  cells: z.array(pointSchema).min(1, { message: "maze.format.noCells" }),
  start: pointSchema,
  treasure: pointSchema,
  segments: z.array(segmentSchema),
  keys: z.array(keySchema),
});

export type Maze = z.infer<typeof mazeSchema>;

export type ParseResult =
  { ok: true; maze: Maze } | { ok: false; issues: TranslatableIssue[] };

/**
 * Parses untrusted input into a Maze. This is shape only — the eleven
 * structural rules in spec §4.1 and the solvability search in §4.2 are
 * separate passes, because they need the match's settings and this does not.
 */
export function parseMaze(input: unknown): ParseResult {
  const result = mazeSchema.safeParse(input);
  if (result.success) return { ok: true, maze: result.data };
  return { ok: false, issues: toTranslatableIssues(result.error) };
}
