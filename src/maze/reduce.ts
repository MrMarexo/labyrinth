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
 *
 * **Every coordinate in this type — `from`, `at`, `revealedCell` and
 * `revealedSegment` — is relative to the start cell**, which is therefore
 * `{ x: 0, y: 0 }` by construction. Negative values are ordinary.
 *
 * Absolute coordinates would disclose the maze's bounding box. `validateMaze`
 * stores `normalize(maze)`, so a stored maze's coordinates always begin at the
 * origin; an absolute `at: { x: 4, y: 0 }` therefore tells a runner who has
 * made no informed move that no cell lies north of their row and that the
 * shape spans at least five columns — the shape they are specifically not
 * supposed to know (spec §2.4). Phase 4 writes an immutable move log, so a
 * leak recorded there is permanent.
 *
 * A spectator or replay converts back to maze coordinates by adding the start
 * cell, which the server knows and the runner does not.
 *
 * The reducer works in absolute maze coordinates throughout; the translation
 * happens once, at the point the delta is built.
 *
 * With `from` present the delta is self-sufficient for replay (spec §8): the
 * edge crossed by a successful move is derivable from `from` → `at` alone, and
 * the start cell is `{ x: 0, y: 0 }` by construction rather than absent. Before
 * `from` existed, replay worked only by reading the `dir` column off the move
 * row and inverting it.
 */
export type RunnerDelta = {
  outcome: RunnerOutcome;
  /**
   * The cell the move started from. Leaks nothing — the runner knows where
   * they just were — and it is what makes the crossed edge derivable.
   */
  from: Point;
  /** Where the runner ended up. Equal to `from` on a blocked move. */
  at: Point;
  penalties: number;
  moves: number;
  finished: boolean;
  revealedCell?: RevealedCell;
  revealedSegment?: RevealedSegment;
};

export function initialRunState(maze: Maze): RunState {
  return {
    // A copy: returning `maze.start` by identity would let a caller mutating
    // `state.at` corrupt the loaded maze.
    at: { ...maze.start },
    keys: 0,
    openedGates: 0,
    penalties: 0,
    moves: 0,
    finished: false,
  };
}

/**
 * Translates an absolute maze coordinate — a cell or an edge address, since
 * both shift alike — into the start-relative frame the runner sees. See
 * RunnerDelta for why the delta is expressed that way.
 */
type Relative = <T extends { x: number; y: number }>(p: T) => T;

function relativeTo(origin: Point): Relative {
  return (p) => ({ ...p, x: p.x - origin.x, y: p.y - origin.y });
}

export function applyMove(
  maze: Maze,
  state: RunState,
  dir: Direction,
): { state: RunState; delta: RunnerDelta; outcome: ServerOutcome } {
  const rel = relativeTo(maze.start);

  if (state.finished) {
    // A defensive floor, not the guard that matters: per spec §11 the move
    // handler rejects a post-finish move with `RunAlreadyFinished` before it
    // ever reaches the reducer. The runner can of course tell this apart from
    // a wall — they know they finished — and should. The hazard is on the
    // server: this branch reports `blocked_wall`, so a handler that wrote a
    // move row per reducer result would persist a wall bump that never
    // happened.
    return {
      state,
      delta: blockDelta(rel, state, "blocked_wall"),
      outcome: "blocked_wall",
    };
  }

  const painted = new Set(maze.cells.map(cellKey));
  const destination = step(state.at, dir);
  const edge = edgeBetween(state.at, dir);

  if (!painted.has(cellKey(destination))) {
    return blocked(rel, state, "blocked_boundary", { ...edge, kind: "wall" });
  }

  const segment = maze.segments.find((s) => edgeKey(s) === edgeKey(edge));

  if (segment?.kind === "wall") {
    return blocked(rel, state, "blocked_wall", { ...edge, kind: "wall" });
  }

  if (segment?.kind === "gate" && !holds(state.keys, segment.gate)) {
    return blocked(rel, state, "blocked_gate", {
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

  const revealedCell: RevealedCell = rel({
    x: destination.x,
    y: destination.y,
  });
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
    ? rel<RevealedSegment>({ ...edge, kind: "gate", gate: segment.gate })
    : undefined;

  return {
    state: next,
    delta: {
      outcome,
      from: rel(state.at),
      at: rel(next.at),
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
  rel: Relative,
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
      from: rel(state.at),
      at: rel(next.at),
      penalties: next.penalties,
      moves: next.moves,
      finished: next.finished,
      revealedSegment: rel(revealedSegment),
    },
    outcome,
  };
}

function blockDelta(
  rel: Relative,
  state: RunState,
  outcome: RunnerOutcome,
): RunnerDelta {
  return {
    outcome,
    from: rel(state.at),
    at: rel(state.at),
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
