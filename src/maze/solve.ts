import { DIRECTIONS, type Maze, type Point } from "./format";
import { cellKey, edgeBetween, edgeKey, step } from "./geometry";

export type SolveResult = {
  solvable: boolean;
  /** Shortest route from start to treasure, or null when unreachable. */
  optimalMoves: number | null;
};

type Blocker = { kind: "wall" } | { kind: "gate"; gate: number };

/**
 * Breadth-first search over `(cell, keysHeld)` states. Searching over cells
 * alone would be wrong: the same square means something different depending on
 * which keys you are carrying, so a cell visited without key 3 must still be
 * visitable later with it.
 *
 * With gates capped at 8 the state space is at most cells x 256.
 *
 * This also subsumes the rule that a gate's key must be obtainable without
 * passing that gate (spec §4.2): a key locked behind its own gate never
 * appears in any reachable state, so the maze is simply unsolvable.
 */
export function solve(maze: Maze): SolveResult {
  const painted = new Set(maze.cells.map(cellKey));
  const blockers = new Map<string, Blocker>();
  for (const segment of maze.segments) {
    blockers.set(
      edgeKey(segment),
      segment.kind === "gate"
        ? { kind: "gate", gate: segment.gate }
        : { kind: "wall" },
    );
  }

  const keyAt = new Map<string, number>();
  for (const key of maze.keys) keyAt.set(cellKey(key), key.gate);

  const treasure = cellKey(maze.treasure);
  if (!painted.has(cellKey(maze.start))) return unsolvable();

  const startKeys = pickUp(0, keyAt.get(cellKey(maze.start)));
  let frontier: Array<{ at: Point; keys: number }> = [
    { at: maze.start, keys: startKeys },
  ];
  const seen = new Set<string>([stateKey(maze.start, startKeys)]);
  let distance = 0;

  if (cellKey(maze.start) === treasure)
    return { solvable: true, optimalMoves: 0 };

  while (frontier.length > 0) {
    distance += 1;
    const next: Array<{ at: Point; keys: number }> = [];

    for (const state of frontier) {
      for (const dir of DIRECTIONS) {
        const destination = step(state.at, dir);
        const id = cellKey(destination);
        if (!painted.has(id)) continue;

        const blocker = blockers.get(edgeKey(edgeBetween(state.at, dir)));
        if (blocker?.kind === "wall") continue;
        if (blocker?.kind === "gate" && !holds(state.keys, blocker.gate))
          continue;

        const keys = pickUp(state.keys, keyAt.get(id));
        if (id === treasure) return { solvable: true, optimalMoves: distance };

        const marker = stateKey(destination, keys);
        if (seen.has(marker)) continue;
        seen.add(marker);
        next.push({ at: destination, keys });
      }
    }

    frontier = next;
  }

  return unsolvable();
}

function unsolvable(): SolveResult {
  return { solvable: false, optimalMoves: null };
}

function stateKey(at: Point, keys: number): string {
  return `${at.x},${at.y}#${keys}`;
}

function holds(keys: number, gate: number): boolean {
  return (keys & (1 << (gate - 1))) !== 0;
}

function pickUp(keys: number, gate: number | undefined): number {
  return gate === undefined ? keys : keys | (1 << (gate - 1));
}
