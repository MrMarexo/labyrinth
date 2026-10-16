import type { Direction, Maze, Point } from "./format";
import { cellKey, edgeKey } from "./geometry";
import {
  applyMove,
  initialRunState,
  type RevealedCell,
  type RevealedSegment,
  type RunnerDelta,
  type RunState,
  type ServerOutcome,
} from "./reduce";

/**
 * Everything a runner knows about the maze they are solving: every cell they
 * have stood on and every segment they have bumped or crossed, in the
 * start-relative frame `RunnerDelta` uses. It is built from deltas and
 * nothing else, so it cannot hold anything a delta did not already disclose.
 */
export type DiscoveredMap = {
  cells: RevealedCell[];
  segments: RevealedSegment[];
};

/** Where the runner is and what they have seen, in their own frame. */
export type RunView = { at: Point; map: DiscoveredMap };

/**
 * What `match_player.run_state` holds. `state` is the reducer's, in absolute
 * maze coordinates, and is server-only: it would disclose the start cell's
 * position, and with it the bounding box. `view` is what a runner may be
 * shown. Both are a cache of the move log (AGENTS.md invariant 4), never the
 * other way round.
 */
export type StoredRun = { state: RunState; view: RunView };

/** The runner knows one thing at the start: that they are on the start cell. */
export function emptyMap(): DiscoveredMap {
  return { cells: [{ x: 0, y: 0 }], segments: [] };
}

export function freshRun(maze: Maze): StoredRun {
  return {
    state: initialRunState(maze),
    view: { at: { x: 0, y: 0 }, map: emptyMap() },
  };
}

export function recordDelta(
  map: DiscoveredMap,
  delta: RunnerDelta,
): DiscoveredMap {
  let cells = map.cells;
  const cell = delta.revealedCell;
  if (cell) {
    const key = cellKey(cell);
    const index = cells.findIndex((c) => cellKey(c) === key);
    // A revisit merges rather than replaces: the reducer reports a key cell's
    // key on every visit, but merging means a future delta that omitted it
    // could still never make the map forget a key the runner holds.
    cells =
      index === -1
        ? [...cells, { ...cell }]
        : cells.map((c, i) => (i === index ? { ...c, ...cell } : c));
  }

  let segments = map.segments;
  const segment = delta.revealedSegment;
  if (segment && !segments.some((s) => edgeKey(s) === edgeKey(segment))) {
    segments = [...segments, { ...segment }];
  }

  return { cells, segments };
}

/**
 * Keys are acquired by stepping onto them, and stepping onto a cell reveals
 * it with its key, so the keys held are exactly the keys on revealed cells.
 */
export function heldKeys(map: DiscoveredMap): number[] {
  return map.cells
    .flatMap((c) => (c.key === undefined ? [] : [c.key]))
    .sort((a, b) => a - b);
}

/**
 * The cells a runner stood on, in order, from the start cell: what the result
 * screen draws. A blocked move goes nowhere, so it adds no point.
 */
export function pathFrom(deltas: readonly RunnerDelta[]): Point[] {
  const path: Point[] = [{ x: 0, y: 0 }];
  for (const d of deltas) {
    if (d.at.x !== d.from.x || d.at.y !== d.from.y) path.push({ ...d.at });
  }
  return path;
}

export function advanceRun(
  run: StoredRun,
  maze: Maze,
  dir: Direction,
): { run: StoredRun; delta: RunnerDelta; outcome: ServerOutcome } {
  const { state, delta, outcome } = applyMove(maze, run.state, dir);
  return {
    run: {
      state,
      view: { at: delta.at, map: recordDelta(run.view.map, delta) },
    },
    delta,
    outcome,
  };
}
