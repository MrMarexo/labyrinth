import { edgeKey, type Edge, type Point } from "~/maze";

/**
 * Geometry for drawing a maze as pixel art: squares as tiles with chipped
 * corners, and walls whose corners step in the way the buttons' do. Plain
 * numbers in, SVG path data and coordinates out, in board pixels.
 */

/** A wall's thickness, in board pixels: one pixel of the icons. */
export const WALL_WIDTH = 4;

/** The grid line between two tiles. */
export const TILE_GAP = 2;

/** How far each tile's corner is chipped. */
export const TILE_CHIP = 2;

/** A wall's line, for a `<line>`; its square cap adds half a width. */
export type WallLine = { x1: number; y1: number; x2: number; y2: number };

/** One filled pixel, as a `<rect>`. */
export type WallPixel = { x: number; y: number; width: number; height: number };

/** Each square as a whole, the grid colour showing between the tiles. */
export function squaresPath(cells: readonly Point[], cellPx: number): string {
  return cells
    .map(
      (c) => `M${c.x * cellPx} ${c.y * cellPx}h${cellPx}v${cellPx}h${-cellPx}z`,
    )
    .join("");
}

/**
 * Each square as a tile, `gap` narrower than the square and with each corner
 * chipped by `chip`: drawn over `squaresPath`, the gaps are the grid.
 */
export function tilesPath(
  cells: readonly Point[],
  cellPx: number,
  gap: number,
  chip: number,
): string {
  const side = cellPx - gap;
  const edge = side - 2 * chip;
  return cells
    .map((c) => {
      const x = c.x * cellPx + gap / 2;
      const y = c.y * cellPx + gap / 2;
      return (
        `M${x + chip} ${y}h${edge}v${chip}h${chip}v${edge}h${-chip}v${chip}` +
        `h${-edge}v${-chip}h${-chip}v${-edge}h${chip}z`
      );
    })
    .join("");
}

type Vertex = { x: number; y: number };

/** The edge's two lattice points, in squares. */
function ends(edge: Edge): [Vertex, Vertex] {
  return edge.o === "H"
    ? [
        { x: edge.x, y: edge.y + 1 },
        { x: edge.x + 1, y: edge.y + 1 },
      ]
    : [
        { x: edge.x + 1, y: edge.y },
        { x: edge.x + 1, y: edge.y + 1 },
      ];
}

const vertexKey = (v: Vertex) => `${v.x},${v.y}`;

/**
 * Walls drawn with pixel corners. Where exactly two walls meet at a right
 * angle, the corner steps in twice, one wall-width each: both walls stop a
 * width short of the corner, and a single pixel inside the bend joins them
 * diagonally. Straight runs, T-junctions, crossings and loose ends are left
 * as they are.
 *
 * `line` gives the line to draw for any of `walls`; `corners` the joining
 * pixels to fill, and `cornersOf` the ones at a given wall's ends.
 */
export function pixelWalls(
  walls: readonly Edge[],
  cellPx: number,
  width: number,
): {
  line: (edge: Edge) => WallLine;
  corners: WallPixel[];
  cornersOf: (edge: Edge) => WallPixel[];
} {
  // Which way each wall leaves each of its ends.
  const leaving = new Map<string, Array<{ dx: number; dy: number }>>();
  for (const wall of walls) {
    const [a, b] = ends(wall);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const at = (v: Vertex) => {
      const list = leaving.get(vertexKey(v)) ?? [];
      leaving.set(vertexKey(v), list);
      return list;
    };
    at(a).push({ dx, dy });
    at(b).push({ dx: -dx, dy: -dy });
  }

  const bends = new Map<string, WallPixel>();
  for (const [key, dirs] of leaving) {
    if (dirs.length !== 2) continue;
    const [p, q] = dirs as [
      { dx: number; dy: number },
      { dx: number; dy: number },
    ];
    if (p.dx * q.dx + p.dy * q.dy !== 0) continue;
    const [vx, vy] = key.split(",").map(Number) as [number, number];
    bends.set(key, {
      x: vx * cellPx + (p.dx + q.dx) * width - width / 2,
      y: vy * cellPx + (p.dy + q.dy) * width - width / 2,
      width,
      height: width,
    });
  }

  // A square cap reaches half a width past the endpoint, so ending the line
  // two widths in leaves the corner and the pixel beside it empty.
  const trim = 2 * width;
  const lines = new Map<string, WallLine>();
  for (const wall of walls) {
    const [a, b] = ends(wall);
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const ta = bends.has(vertexKey(a)) ? trim : 0;
    const tb = bends.has(vertexKey(b)) ? trim : 0;
    lines.set(edgeKey(wall), {
      x1: a.x * cellPx + ux * ta,
      y1: a.y * cellPx + uy * ta,
      x2: b.x * cellPx - ux * tb,
      y2: b.y * cellPx - uy * tb,
    });
  }

  return {
    line: (edge) => {
      const found = lines.get(edgeKey(edge));
      if (found) return found;
      const [a, b] = ends(edge);
      return {
        x1: a.x * cellPx,
        y1: a.y * cellPx,
        x2: b.x * cellPx,
        y2: b.y * cellPx,
      };
    },
    corners: [...bends.values()],
    cornersOf: (edge) =>
      ends(edge).flatMap((v) => bends.get(vertexKey(v)) ?? []),
  };
}
