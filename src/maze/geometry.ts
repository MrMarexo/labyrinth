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
