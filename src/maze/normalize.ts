import type { Maze, MazeKey, Point, Segment } from "./format";

function byPoint(a: Point, b: Point): number {
  return a.y - b.y || a.x - b.x;
}

function bySegment(a: Segment, b: Segment): number {
  return (
    a.o.localeCompare(b.o) ||
    a.y - b.y ||
    a.x - b.x ||
    a.kind.localeCompare(b.kind)
  );
}

function byKey(a: MazeKey, b: MazeKey): number {
  return a.gate - b.gate;
}

/**
 * Translates the shape so its bounding box starts at the origin and sorts
 * every collection into one canonical order. Two authors who drew the same
 * labyrinth in different corners of the canvas normalize to the same value,
 * which is what makes the content hash mean "same maze" rather than "same
 * JSON" (spec §3.2).
 */
export function normalize(maze: Maze): Maze {
  const dx = Math.min(...maze.cells.map((c) => c.x));
  const dy = Math.min(...maze.cells.map((c) => c.y));
  const shift = <T extends Point>(p: T): T => ({
    ...p,
    x: p.x - dx,
    y: p.y - dy,
  });

  return {
    version: maze.version,
    cells: maze.cells.map(shift).sort(byPoint),
    start: shift(maze.start),
    treasure: shift(maze.treasure),
    segments: maze.segments.map(shift).sort(bySegment),
    keys: maze.keys.map(shift).sort(byKey),
  };
}

/** A stable string for an already-normalized maze. Field order is fixed here. */
export function canonicalString(maze: Maze): string {
  const cells = maze.cells.map((c) => `${c.x},${c.y}`).join(";");
  const segments = maze.segments
    .map((s) => `${s.o}${s.x},${s.y}${s.kind === "gate" ? `g${s.gate}` : "w"}`)
    .join(";");
  const keys = maze.keys.map((k) => `${k.gate}@${k.x},${k.y}`).join(";");
  return [
    `v${maze.version}`,
    `c:${cells}`,
    `s:${maze.start.x},${maze.start.y}`,
    `t:${maze.treasure.x},${maze.treasure.y}`,
    `e:${segments}`,
    `k:${keys}`,
  ].join("|");
}

/**
 * FNV-1a over the canonical string. This identifies a maze for deduplication
 * and reuse in a player's library — it is not a security boundary, so a fast
 * non-cryptographic hash is the right tool, and it avoids pulling a crypto
 * dependency into a module that must run unchanged in a browser.
 */
export function contentHash(maze: Maze): string {
  const text = canonicalString(normalize(maze));

  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, "0");
}
