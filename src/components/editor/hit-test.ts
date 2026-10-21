import { isInteriorEdge, type Edge, type Point } from "~/maze";

// Pure pointer geometry for the editor board. Every coordinate is in cell
// units — (2.5, 2.5) is the centre of square (2,2) — so the caller divides
// by the pixel size once and nothing here depends on it.

/** How close to an edge, in cells, a point must be to count as on it. */
export const EDGE_REACH = 0.3;
/**
 * How far from a corner, in cells, a point must be for an edge to count.
 * At a corner two edges are equally near, so a swipe along one line would
 * otherwise flick walls onto the perpendicular one at every crossing.
 */
export const CORNER_DEAD_ZONE = 0.15;

export function cellUnder(p: { x: number; y: number }): Point {
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

/**
 * The nearest of the containing square's four edges, or null when it is
 * further than `EDGE_REACH`, inside a corner's dead zone, or not interior
 * (both sides painted) — a wall can never sit on the outline.
 */
export function nearestInteriorEdge(
  p: { x: number; y: number },
  painted: ReadonlySet<string>,
): Edge | null {
  const cell = cellUnder(p);
  const fx = p.x - cell.x;
  const fy = p.y - cell.y;

  const candidates: { edge: Edge; distance: number; along: number }[] = [
    { edge: { o: "H", x: cell.x, y: cell.y - 1 }, distance: fy, along: fx },
    { edge: { o: "H", x: cell.x, y: cell.y }, distance: 1 - fy, along: fx },
    { edge: { o: "V", x: cell.x - 1, y: cell.y }, distance: fx, along: fy },
    { edge: { o: "V", x: cell.x, y: cell.y }, distance: 1 - fx, along: fy },
  ];
  const nearest = candidates.reduce((a, b) =>
    b.distance < a.distance ? b : a,
  );

  if (nearest.distance > EDGE_REACH) return null;
  if (Math.min(nearest.along, 1 - nearest.along) < CORNER_DEAD_ZONE) {
    return null;
  }
  return isInteriorEdge(nearest.edge, painted) ? nearest.edge : null;
}

/**
 * Bresenham's line from `a` to `b`, both included, so a swipe faster than
 * the pointer's sample rate still leaves no gap between squares.
 */
export function cellsBetween(a: Point, b: Point): Point[] {
  const cells: Point[] = [];
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let error = dx + dy;
  let { x, y } = a;

  for (;;) {
    cells.push({ x, y });
    if (x === b.x && y === b.y) return cells;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/**
 * Points from `a` to `b`, both included, no further than `spacing` apart.
 * Edges are hit-tested at each, so a fast swipe along a line of edges
 * still touches every one of them.
 */
export function samplesBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
  spacing: number,
): { x: number; y: number }[] {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing),
  );
  const samples = [a];
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  samples.push(b);
  return samples;
}

/** Whether `at` is a square of the frame. */
export function inFrame(at: Point, frame: number): boolean {
  return at.x >= 0 && at.x < frame && at.y >= 0 && at.y < frame;
}
