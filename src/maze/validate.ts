import type { TranslatableIssue } from "~/lib/issues";
import { MAX_BOUNDING_BOX, type Maze } from "./format";
import { cellKey, edgeKey, step } from "./geometry";

export type MazeSettings = { cellCount: number; gateCount: number };

/**
 * The eleven structural rules from spec §4.1. Returns every issue it finds
 * rather than the first, because the editor shows them all at once.
 *
 * Solvability is deliberately not here — it is a search, it belongs in
 * `solve.ts`, and a maze can be worth reporting on structurally long before it
 * is solvable. `version` is also not re-checked here: the `Maze` type already
 * guarantees it, because every caller gets there through `parseMaze`.
 */
export function validateStructure(
  maze: Maze,
  settings: MazeSettings,
): TranslatableIssue[] {
  const issues: TranslatableIssue[] = [];
  const add = (key: string, params?: Record<string, string | number>) =>
    issues.push(params ? { key, params } : { key });

  const painted = new Set(maze.cells.map(cellKey));

  if (maze.cells.length !== settings.cellCount) {
    add("maze.validate.wrongCellCount", {
      expected: settings.cellCount,
      actual: maze.cells.length,
    });
  }

  if (painted.size !== maze.cells.length) add("maze.validate.duplicateCell");

  const xs = maze.cells.map((c) => c.x);
  const ys = maze.cells.map((c) => c.y);
  const width = Math.max(...xs) - Math.min(...xs) + 1;
  const height = Math.max(...ys) - Math.min(...ys) + 1;
  if (width > MAX_BOUNDING_BOX || height > MAX_BOUNDING_BOX) {
    add("maze.validate.boundingBoxTooLarge", {
      max: MAX_BOUNDING_BOX,
      width,
      height,
    });
  }

  if (!isConnected(maze, painted)) add("maze.validate.disconnectedShape");

  const startIn = painted.has(cellKey(maze.start));
  const treasureIn = painted.has(cellKey(maze.treasure));
  if (!startIn) add("maze.validate.startNotInShape");
  if (!treasureIn) add("maze.validate.treasureNotInShape");
  if (cellKey(maze.start) === cellKey(maze.treasure)) {
    add("maze.validate.startIsTreasure");
  }

  // Occupancy: at most one of { key, treasure } per cell, and nothing on start.
  const occupied = new Map<string, number>();
  occupied.set(cellKey(maze.treasure), 1);
  for (const key of maze.keys) {
    const at = cellKey(key);
    occupied.set(at, (occupied.get(at) ?? 0) + 1);
    if (at === cellKey(maze.start)) add("maze.validate.keyOnStart");
    if (!painted.has(at))
      add("maze.validate.keyOutsideShape", { gate: key.gate });
  }
  for (const [, count] of occupied) {
    if (count > 1) {
      add("maze.validate.cellHoldsTwoThings");
      break;
    }
  }

  // Segments: both sides painted, and no edge named twice.
  const seenEdges = new Set<string>();
  for (const segment of maze.segments) {
    const here = { x: segment.x, y: segment.y };
    const other = segment.o === "H" ? step(here, "S") : step(here, "E");
    if (!painted.has(cellKey(here)) || !painted.has(cellKey(other))) {
      add("maze.validate.segmentOutsideShape");
    }
    const id = edgeKey(segment);
    if (seenEdges.has(id)) add("maze.validate.duplicateSegment");
    seenEdges.add(id);
  }

  // Gates: ids exactly 1..gateCount, each on one segment, each with one key.
  const gateIds = maze.segments
    .filter((s) => s.kind === "gate")
    .map((s) => s.gate);
  const gateSet = new Set(gateIds);
  if (gateSet.size !== gateIds.length) add("maze.validate.gateIdReused");

  const expected = Array.from({ length: settings.gateCount }, (_, i) => i + 1);
  const contiguous =
    gateSet.size === settings.gateCount &&
    expected.every((id) => gateSet.has(id));
  if (!contiguous) {
    add("maze.validate.gateIdsNotContiguous", { expected: settings.gateCount });
  }

  for (const id of gateSet) {
    const matching = maze.keys.filter((k) => k.gate === id);
    if (matching.length === 0)
      add("maze.validate.gateWithoutKey", { gate: id });
    if (matching.length > 1) add("maze.validate.gateWithTwoKeys", { gate: id });
  }
  for (const key of maze.keys) {
    if (!gateSet.has(key.gate)) {
      add("maze.validate.keyWithoutGate", { gate: key.gate });
    }
  }

  return issues;
}

/**
 * Flood fill over painted cells, ignoring walls entirely. This asks whether
 * the shape is one piece, not whether it is traversable — a sealed pocket is
 * legal (spec §4.2), a floating island is not.
 */
function isConnected(maze: Maze, painted: Set<string>): boolean {
  const first = maze.cells[0];
  if (!first) return false;

  const seen = new Set<string>([cellKey(first)]);
  const queue = [first];

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const dir of ["N", "E", "S", "W"] as const) {
      const next = step(current, dir);
      const id = cellKey(next);
      if (painted.has(id) && !seen.has(id)) {
        seen.add(id);
        queue.push(next);
      }
    }
  }

  return seen.size === painted.size;
}
