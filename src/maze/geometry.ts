import type { Direction, Orientation, Point } from "./format";

export type Edge = { o: Orientation; x: number; y: number };

/** The cell one step from `point` in `dir`. y increases downward (spec §3.1). */
export function step(point: Point, dir: Direction): Point {
  switch (dir) {
    case "N":
      return { x: point.x, y: point.y - 1 };
    case "S":
      return { x: point.x, y: point.y + 1 };
    case "W":
      return { x: point.x - 1, y: point.y };
    case "E":
      return { x: point.x + 1, y: point.y };
  }
}

/**
 * The single legal spelling of the edge crossed when leaving `from` in `dir`.
 * Each interior edge has exactly one name, which is what makes a duplicate a
 * validation error rather than a silent disagreement between two copies.
 */
export function edgeBetween(from: Point, dir: Direction): Edge {
  switch (dir) {
    case "N":
      return { o: "H", x: from.x, y: from.y - 1 };
    case "S":
      return { o: "H", x: from.x, y: from.y };
    case "W":
      return { o: "V", x: from.x - 1, y: from.y };
    case "E":
      return { o: "V", x: from.x, y: from.y };
  }
}

export function cellKey(p: Point): string {
  return `${p.x},${p.y}`;
}

export function edgeKey(e: Edge): string {
  return `${e.o}:${e.x},${e.y}`;
}

const DIRECTIONS: readonly Direction[] = ["N", "S", "W", "E"];

/**
 * Every edge with exactly one painted side: the shape's outline, including
 * the border of any unpainted hole inside it. Edges on the frame border come
 * out with a coordinate of -1 (e.g. `H(x,-1)` is the top of row 0), which is
 * fine for drawing and never stored — outward-facing edges are implicit
 * walls (spec §2.3).
 */
export function outlineEdges(cells: readonly Point[]): Edge[] {
  const painted = new Set(cells.map(cellKey));
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const cell of cells) {
    if (seen.has(cellKey(cell))) continue;
    seen.add(cellKey(cell));
    for (const dir of DIRECTIONS) {
      // Each outline edge is emitted only from its one painted side, so it
      // can never appear twice.
      if (!painted.has(cellKey(step(cell, dir)))) {
        edges.push(edgeBetween(cell, dir));
      }
    }
  }
  return edges;
}

/** True when both cells either side of `edge` are painted. */
export function isInteriorEdge(
  edge: Edge,
  painted: ReadonlySet<string>,
): boolean {
  const here = { x: edge.x, y: edge.y };
  const there = edge.o === "H" ? step(here, "S") : step(here, "E");
  return painted.has(cellKey(here)) && painted.has(cellKey(there));
}
