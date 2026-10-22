import type { Direction, Point } from "./format";
import { cellKey, edgeBetween, edgeKey, step } from "./geometry";
import type {
  RevealedCell,
  RevealedSegment,
  RunnerDelta,
  RunnerOutcome,
} from "./reduce";
import { withPassages, type DiscoveredMap } from "./run";

/** What the client holds about its own run: its `run.get`, less the rest. */
export type PredictableView = {
  at: Point;
  map: DiscoveredMap;
  penalties: number;
  moves: number;
};

/**
 * The server's answer to a move, when the runner already knows it for
 * certain (spec §7.3): a step back through an edge they have walked through
 * before. Everything in it comes from the runner's own map, so predicting
 * discloses nothing a delta did not.
 *
 * Null for anything the map cannot settle: an edge never tried, a known
 * wall, or a gate never crossed. A gate already crossed is a passage — keys
 * are never lost — and is predicted as a crossing, as the reducer reports
 * one on every pass. A predicted move never bumps, so never adds a penalty.
 */
export function predictMove(
  view: PredictableView,
  dir: Direction,
): RunnerDelta | null {
  const map = withPassages(view.map);
  const edge = edgeKey(edgeBetween(view.at, dir));
  if (!map.passages.some((p) => edgeKey(p) === edge)) return null;

  const to = step(view.at, dir);
  const known = map.cells.find((c) => cellKey(c) === cellKey(to));
  // A passage is only ever recorded with the cell it led to.
  if (!known) return null;
  const gate = map.segments.find(
    (s): s is Extract<RevealedSegment, { kind: "gate" }> =>
      edgeKey(s) === edge && s.kind === "gate",
  );

  // The reducer's priority order: treasure, key, gate, plain move.
  const outcome: RunnerOutcome = known.treasure
    ? "moved_found_treasure"
    : known.key !== undefined
      ? "moved_found_key"
      : gate
        ? "moved_through_gate"
        : "moved";

  const revealedCell: RevealedCell = { x: to.x, y: to.y };
  if (known.treasure) revealedCell.treasure = true;
  if (known.key !== undefined) revealedCell.key = known.key;

  return {
    outcome,
    from: { ...view.at },
    at: to,
    penalties: view.penalties,
    moves: view.moves + 1,
    finished: known.treasure === true,
    revealedCell,
    ...(gate ? { revealedSegment: { ...gate } } : {}),
  };
}

/**
 * Whether two deltas say the same thing — the check a predicted move is
 * reconciled with. Field by field, so key order and an `undefined` optional
 * field (which JSON drops on the wire) make no difference.
 */
export function sameDelta(a: RunnerDelta, b: RunnerDelta): boolean {
  const point = (p?: Point, q?: Point) =>
    p === undefined || q === undefined ? p === q : p.x === q.x && p.y === q.y;
  const cell = (p?: RevealedCell, q?: RevealedCell) =>
    point(p, q) &&
    p?.key === q?.key &&
    (p?.treasure ?? false) === (q?.treasure ?? false);
  const segment = (p?: RevealedSegment, q?: RevealedSegment) =>
    p === undefined || q === undefined
      ? p === q
      : edgeKey(p) === edgeKey(q) &&
        p.kind === q.kind &&
        (p.kind === "gate" ? p.gate : 0) === (q.kind === "gate" ? q.gate : 0);
  return (
    a.outcome === b.outcome &&
    point(a.from, b.from) &&
    point(a.at, b.at) &&
    a.penalties === b.penalties &&
    a.moves === b.moves &&
    a.finished === b.finished &&
    cell(a.revealedCell, b.revealedCell) &&
    segment(a.revealedSegment, b.revealedSegment)
  );
}
