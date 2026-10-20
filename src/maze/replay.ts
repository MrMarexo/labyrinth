import type { Point } from "./format";
import type { RunnerDelta } from "./reduce";
import {
  emptyMap,
  heldKeys,
  pathFrom,
  recordDelta,
  type DiscoveredMap,
} from "./run";

/**
 * One row of the move log as a viewer sees it — and exactly the payload of a
 * `move` event (spec §8), so the stored log and the live channel feed the
 * same timeline.
 */
export type LoggedMove = { seq: number; delta: RunnerDelta };

/**
 * Moves from the log and from the channel, in seq order, each once. A seq
 * already known wins over a later copy: the server only ever sends one delta
 * per seq, so a disagreeing copy can only be a stale or forged one.
 */
export function mergeMoves(
  known: readonly LoggedMove[],
  incoming: readonly LoggedMove[],
): LoggedMove[] {
  const bySeq = new Map<number, LoggedMove>();
  for (const m of known) if (!bySeq.has(m.seq)) bySeq.set(m.seq, m);
  for (const m of incoming) if (!bySeq.has(m.seq)) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * The moves that can be played: the unbroken run from seq 1. A later move
 * that arrived before an earlier one waits until the gap is filled — a
 * timeline with a hole in it would draw a map the runner never saw.
 */
export function playable(moves: readonly LoggedMove[]): LoggedMove[] {
  const out: LoggedMove[] = [];
  for (const m of moves) {
    if (m.seq !== out.length + 1) break;
    out.push(m);
  }
  return out;
}

/** Everything the viewer draws at one point in the timeline. */
export type Frame = {
  map: DiscoveredMap;
  /** Start-relative, like every delta. */
  at: Point;
  penalties: number;
  moves: number;
  finished: boolean;
  heldKeys: number[];
  last: RunnerDelta | null;
  /** Start-relative; the viewer translates it onto the full maze. */
  path: Point[];
};

/** The runner's view after the first `step` moves (clamped to the timeline). */
export function frameAt(moves: readonly LoggedMove[], step: number): Frame {
  const n = Math.max(0, Math.min(step, moves.length));
  let map = emptyMap();
  const deltas: RunnerDelta[] = [];
  for (let i = 0; i < n; i += 1) {
    const delta = moves[i]!.delta;
    map = recordDelta(map, delta);
    deltas.push(delta);
  }
  const last = deltas.at(-1) ?? null;
  return {
    map,
    at: last ? { ...last.at } : { x: 0, y: 0 },
    penalties: last?.penalties ?? 0,
    moves: last?.moves ?? 0,
    finished: last?.finished ?? false,
    heldKeys: heldKeys(map),
    last,
    path: pathFrom(deltas),
  };
}
