import type { Direction, Maze, Orientation, Point } from "./format";
import { cellKey, edgeBetween, edgeKey, step } from "./geometry";

/** Spec §7. `blocked_boundary` is server-side only — see RunnerDelta. */
export type ServerOutcome =
  | "moved"
  | "moved_found_key"
  | "moved_found_treasure"
  | "moved_through_gate"
  | "blocked_wall"
  | "blocked_gate"
  | "blocked_boundary";

export type RunnerOutcome = Exclude<ServerOutcome, "blocked_boundary">;

export type RunState = {
  at: Point;
  /** Bitmask: bit (gate - 1) set means the key for that gate is held. */
  keys: number;
  openedGates: number;
  penalties: number;
  moves: number;
  finished: boolean;
};

export type RevealedSegment =
  | { o: Orientation; x: number; y: number; kind: "wall" }
  | { o: Orientation; x: number; y: number; kind: "gate"; gate: number };

export type RevealedCell = {
  x: number;
  y: number;
  key?: number;
  treasure?: true;
};

/**
 * Everything the runner learns from one move, and nothing else. If a field is
 * here, the runner knows it; the maze itself never crosses this boundary.
 */
export type RunnerDelta = {
  outcome: RunnerOutcome;
  at: Point;
  penalties: number;
  moves: number;
  finished: boolean;
  revealedCell?: RevealedCell;
  revealedSegment?: RevealedSegment;
};

export function initialRunState(maze: Maze): RunState {
  return {
    at: maze.start,
    keys: 0,
    openedGates: 0,
    penalties: 0,
    moves: 0,
    finished: false,
  };
}

export function applyMove(
  maze: Maze,
  state: RunState,
  dir: Direction,
): { state: RunState; delta: RunnerDelta; outcome: ServerOutcome } {
  if (state.finished) {
    // A finished run accepts no further moves. Reported as a plain block so a
    // replayed or duplicated request cannot be distinguished from a wall.
    return {
      state,
      delta: blockDelta(state, "blocked_wall"),
      outcome: "blocked_wall",
    };
  }

  const painted = new Set(maze.cells.map(cellKey));
  const destination = step(state.at, dir);
  const edge = edgeBetween(state.at, dir);

  if (!painted.has(cellKey(destination))) {
    return blocked(state, "blocked_boundary", { ...edge, kind: "wall" });
  }

  const segment = maze.segments.find((s) => edgeKey(s) === edgeKey(edge));

  if (segment?.kind === "wall") {
    return blocked(state, "blocked_wall", { ...edge, kind: "wall" });
  }

  if (segment?.kind === "gate" && !holds(state.keys, segment.gate)) {
    return blocked(state, "blocked_gate", {
      ...edge,
      kind: "gate",
      gate: segment.gate,
    });
  }

  const throughGate = segment?.kind === "gate";
  const keyHere = maze.keys.find((k) => cellKey(k) === cellKey(destination));
  const isTreasure = cellKey(destination) === cellKey(maze.treasure);

  const next: RunState = {
    at: destination,
    keys: keyHere ? state.keys | bit(keyHere.gate) : state.keys,
    openedGates: throughGate
      ? state.openedGates | bit(segment.gate)
      : state.openedGates,
    penalties: state.penalties,
    moves: state.moves + 1,
    finished: isTreasure,
  };

  // Treasure wins the priority order: landing on it ends the run, and
  // reporting "you found a key" at the moment the run finished would be the
  // wrong thing to tell the client. A key sharing the treasure cell is
  // rejected upstream by validateStructure (maze.validate.cellHoldsTwoThings),
  // so this ordering is never actually observable in a valid maze — but the
  // reducer does not itself validate, so the order is still a deliberate
  // choice rather than an accident of iteration.
  const outcome: ServerOutcome = isTreasure
    ? "moved_found_treasure"
    : keyHere
      ? "moved_found_key"
      : throughGate
        ? "moved_through_gate"
        : "moved";

  const revealedCell: RevealedCell = { x: destination.x, y: destination.y };
  // Independent by design, unlike outcome: a cell can carry both flags (a
  // configuration validateStructure forbids, but the reducer does not
  // validate), and each flag simply states a fact that is true regardless of
  // which single label outcome picked.
  if (isTreasure) revealedCell.treasure = true;
  if (keyHere) revealedCell.key = keyHere.gate;

  // Crossing a gate reveals it, even though the runner holds its key and
  // bumped nothing: replay (spec §8) reconstructs the discovered map from the
  // stored deltas alone, with no socket and no live client state to fall back
  // on, so if this delta doesn't say a gate was here, replay draws open floor
  // and the gate's id — which the runner never learned by bumping it either
  // — is unrecoverable. The runner already earned this fact by crossing.
  const revealedSegment: RevealedSegment | undefined = throughGate
    ? { ...edge, kind: "gate", gate: segment.gate }
    : undefined;

  return {
    state: next,
    delta: {
      outcome,
      at: next.at,
      penalties: next.penalties,
      moves: next.moves,
      finished: next.finished,
      revealedCell,
      revealedSegment,
    },
    outcome,
  };
}

/**
 * A blocked move. `blocked_boundary` is collapsed to `blocked_wall` on the way
 * out, and the revealed segment is described as a wall whether or not one
 * exists in the data — a runner who could tell an unpainted square from a
 * walled one could map the shape by bumping, which is the whole secret.
 */
function blocked(
  state: RunState,
  outcome: ServerOutcome,
  revealedSegment: RevealedSegment,
): { state: RunState; delta: RunnerDelta; outcome: ServerOutcome } {
  const next: RunState = {
    ...state,
    penalties: state.penalties + 1,
    moves: state.moves + 1,
  };

  const runnerOutcome: RunnerOutcome =
    outcome === "blocked_boundary" ? "blocked_wall" : outcome;

  return {
    state: next,
    delta: {
      outcome: runnerOutcome,
      at: next.at,
      penalties: next.penalties,
      moves: next.moves,
      finished: next.finished,
      revealedSegment,
    },
    outcome,
  };
}

function blockDelta(state: RunState, outcome: RunnerOutcome): RunnerDelta {
  return {
    outcome,
    at: state.at,
    penalties: state.penalties,
    moves: state.moves,
    finished: state.finished,
  };
}

function bit(gate: number): number {
  return 1 << (gate - 1);
}

function holds(keys: number, gate: number): boolean {
  return (keys & bit(gate)) !== 0;
}
