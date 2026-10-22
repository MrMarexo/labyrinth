/**
 * The SVG viewBox that frames a maze's painted cells, `cellPx` per cell,
 * with half a cell of margin all round so the outer walls are not clipped.
 * An empty maze gets one blank cell rather than an infinite box.
 */
export function mazeViewBox(
  cells: readonly { x: number; y: number }[],
  cellPx: number,
): string {
  if (cells.length === 0) return `0 0 ${cellPx} ${cellPx}`;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  return `${(minX - 0.5) * cellPx} ${(minY - 0.5) * cellPx} ${
    (maxX - minX + 2) * cellPx
  } ${(maxY - minY + 2) * cellPx}`;
}
