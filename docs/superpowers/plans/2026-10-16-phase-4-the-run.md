# Phase 4 — The Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player in a `running` match walks the opponent's labyrinth through the fog to the treasure, bumping walls for penalties, collecting keys and opening gates. The match completes when both have finished or one gives up, and only then reveals the result, both full mazes and both paths.

**Architecture:** Two new pure modules carry every rule that can be wrong. `src/maze/run.ts` holds the runner's discovered map and the stored run. `src/match/completion.ts` holds scoring, tiebreakers and give-up. A new `runRouter` is the only writer of moves. It serialises each match behind a row lock and writes the move, the run state, the deadline and any completion in one transaction. The client is a status-driven screen on the existing `/matches/[id]` URL: lobby, then run, then result.

**Tech Stack:** Next.js App Router, tRPC, Drizzle (`drizzle-orm/neon-serverless` with `Pool`), Postgres on Neon, Better Auth, next-intl, Tailwind v4, Vitest, fast-check, Playwright, `@axe-core/playwright` (new, Task 9).

**Spec:** `docs/superpowers/specs/2026-09-22-labyrinth-design.md`: §2 (rules), §6 (data model), §7 (move protocol), §9.1–9.2 (deadlines, giving up), §10.3–10.3.1 (run view, result), §11 (errors), §12 (testing).

## Global Constraints

- **Purity.** `src/maze/**`, `src/match/**` and `src/lib/issues.ts` import nothing from Next, React, tRPC, Drizzle, Better Auth, next-intl, `@t3-oss/*`, `@neondatabase/*`, Node builtins, or the `~/server`, `~/app`, `~/components`, `~/trpc`, `~/i18n`, `~/env`, `~/styles` aliases. ESLint enforces this (AGENTS.md invariant 2).
- **No clock inside the pure domain.** Every time-dependent function takes its timestamps as arguments.
- **The runner never receives `maze.data` while the match is open.** `run.move` is the one runner-reachable procedure that *reads* the maze, and it returns only a `RunnerDelta`. `run.result` returns mazes, but only for a terminal match in which both players submitted.
- **A void-blocked move is indistinguishable from a wall-blocked move** in everything the runner receives and everything the client renders (AGENTS.md invariant 6). The `move.outcome` column keeps `blocked_boundary`; the stored and returned `delta` never does.
- **The move log is the source of truth** (invariant 4). `match_player.run_state` is a cache, written in the same transaction as the move that changes it.
- **§7.2 idempotency:** a retried `seq` returns the stored delta and writes nothing. A retry can never add a phantom penalty.
- **§7.3 no optimistic movement:** the client draws nothing until the server answers.
- **Scoring (§2.6):** fewest penalties, then fewest moves, then shortest elapsed time (first move → treasure). A perfect tie completes with no winner.
- **Giving up (§9.2)** ends the match at once with the opponent as winner, `endReason: forfeit`. **Expiry** still never produces a winner who did not reach the treasure.
- **The result is withheld until the match is terminal.** No procedure tells a running player the opponent's penalties, moves, time or position.
- **Errors travel as i18n keys**, both catalogues, asserted by code (§11).
- **Both locales carry identical key sets**, and a unit test enforces it. Counted strings use ICU `plural` with Slovak `one`/`few`/`other`.
- **Colours come from CSS custom properties** (invariant 10). Animations respect `prefers-reduced-motion`.
- **Migrations are additive** (AGENTS.md "Migrations on deploy"): no dropped or renamed columns in this phase.
- `MAX_BOUNDING_BOX = 16`, `MAX_GATES = 8`, `CELL_COUNT_PRESETS = [36, 64, 100, 144]`.

## Review Focus

Inputs and conditions the spec implies but no task's ordinary flow would hit. Each has a test in the task that owns the code, named here so a reviewer can find it.

1. **Two requests carrying the same `seq` at the same moment** (a double-click, a retried request racing the original). Expected: exactly one move row and one penalty, and both callers get the same delta. → Task 5, "two concurrent moves on one seq write one row".
2. **A move or a give-up arriving after `deadlineAt` but before the sweep has run.** Expected: refused with `errors.matchExpired`. A give-up must never turn an abandoned-to-be match into a win. → Task 5 and Task 6.
3. **A result screen for a match abandoned during `drawing`**, where one player submitted and the other never did. Expected: no maze is revealed. `mazesFacedBy` does not mark that maze as faced, so revealing it would show a maze its author may still reuse against this opponent. → Task 6, "reveals no maze for a match that never reached running".
4. **The runner's one-moved deadline** (§9.1 row 6, added during Phase 3 but never implemented). Phase 4 makes it reachable for the first time. Expected: 24h from the mover's last move, with blame on the player who never moved. Without the fix, an active match abandons at a fixed 24h from the unlocking. → Task 2.
5. **A retried finishing move**, and **a move from a second open tab**. The retry must still get its stored delta after the run, or the whole match, has ended. The stale tab sends a `seq` that is already behind and must resync, not wedge. → Task 5, "replays the finishing move after the match completed" and "rejects a seq that is not next".

## What Phase 4 does *not* build

Recorded in `docs/backlog.md`, which Task 10 updates:

- **Publishing moves to realtime** (§7 step 4, §8). Phase 5. Phase 4 writes the move log and nothing else, and "your opponent gave up" reaches an open run view by polling.
- **Spectating and animated replay.** Phase 5. The result screen's static path overlay is the stand-in (§10.3.1).
- **Rematch, notifications to a player who is not on the page, points or ratings.**
- **Live lobby updates.** The lobby still needs a refresh to see an opponent's submission.

## Deviations from the spec's letter, settled here

Task 3 writes each of these back into the spec, so the spec and the code stay one source.

- **No `runStatus` column.** It is derivable: not started (`startedAt` null), running, finished (`finishedAt`), gave up (`gaveUpAt`). Phase 3 left out `bothJoinedAt` and `unlockedAt` for the same reason: a stored copy of a derivable value is a second source of truth.
- **No `penalties` / `moveCount` columns.** Both live once, inside `run_state.state`, beside the position they belong with.
- **`move.revealed` is `move.delta`** and holds the whole `RunnerDelta`. It is exactly what a retried request must get back, and what replay will read.
- **A new `match_player.gave_up_at` column.** The reason line has to tell "gave up" apart from "ran out of time", and `forfeitedAt` already means the latter.
- **The procedures are `run.get`, `run.move`, `run.giveUp`, `run.result`**, mounted on a new `run` router. §7 says `match.move`. `match.ts` is already 450 lines, and the run's procedures share helpers the lobby's do not.

## File Structure

| File | Responsibility |
|---|---|
| `src/maze/run.ts` | The discovered map, the stored run, and `pathFrom`. Pure. |
| `src/maze/reduce.ts` | Gains `SERVER_OUTCOMES`, the runtime list behind the existing `ServerOutcome` type. |
| `src/match/completion.ts` | `RunFacts`, scoring, `resolveCompletion`, `decidingField`, `elapsedMs`. Pure. |
| `src/match/deadline.ts` | Gains §9.1 row 6 (one has moved) and its blame. |
| `src/lib/open-maze.ts` | Gains `gatedMazeDraft` and its scripted route, for seeding. |
| `src/lib/format-elapsed.ts` | `h:mm:ss` / `m:ss` for run times. Pure. |
| `src/server/db/schema/match.ts` | Run columns on `match_player`; the `move` table. |
| `src/server/match/access.ts` | `DbClient`, `participantRows` (now with an optional row lock), `notYours`, moved out of `match.ts`. |
| `src/server/match/situation.ts` | Feeds `lastMoveAt` and `finishedAt` into the pure domain. |
| `src/server/api/routers/run.ts` | `get`, `move`, `giveUp`, `result`. |
| `src/server/api/routers/test-support.ts` | `seedMaze` gains `layout: "gated"`. |
| `src/components/run/run-board.tsx` | The fogged board: discovered cells and segments only. |
| `src/components/run/use-move-queue.ts` | Sequential `seq`-numbered moves with one waiting slot. |
| `src/components/run/run-view.tsx` | HUD, input, announcements, waiting state, give-up. |
| `src/components/run/result-maze.tsx` | One full maze, read-only, with a path drawn over it. |
| `src/components/run/match-result.tsx` | Outcome, reason, score table, both mazes. |
| `src/components/match/match-screen.tsx` | Chooses lobby, run or result by status, and polls while running. |
| `e2e/run.spec.ts` | Play to completion; give up. |

---

## Task 1: The discovered map

**Files:**
- Create: `src/maze/run.ts`, `tests/unit/maze/run.test.ts`
- Modify: `src/maze/reduce.ts` (add `SERVER_OUTCOMES`), `src/maze/index.ts` (export `./run`)

**Interfaces:**
- Consumes: `applyMove`, `initialRunState`, `RunState`, `RunnerDelta`, `RevealedCell`, `RevealedSegment` from `./reduce`; `cellKey`, `edgeKey` from `./geometry`; `Direction`, `Maze`, `Point` from `./format`.
- Produces:
  - `SERVER_OUTCOMES: readonly ServerOutcome[]` (in `reduce.ts`)
  - `type DiscoveredMap = { cells: RevealedCell[]; segments: RevealedSegment[] }`
  - `emptyMap(): DiscoveredMap`
  - `recordDelta(map: DiscoveredMap, delta: RunnerDelta): DiscoveredMap`
  - `heldKeys(map: DiscoveredMap): number[]`
  - `pathFrom(deltas: readonly RunnerDelta[]): Point[]`
  - `type RunView = { at: Point; map: DiscoveredMap }`
  - `type StoredRun = { state: RunState; view: RunView }`
  - `freshRun(maze: Maze): StoredRun`
  - `advanceRun(run: StoredRun, maze: Maze, dir: Direction): { run: StoredRun; delta: RunnerDelta; outcome: ServerOutcome }`

**Why held keys are derived and not sent:** `RunnerDelta` has no keys field, and it does not need one. Keys are picked up by stepping on them, and stepping on a cell reveals it with its `key`. So "every revealed cell that carries a key" is exactly the set the runner holds. Deriving it means there is nothing to keep in sync.

- [ ] **Step 1: Write the failing tests**

`tests/unit/maze/run.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DIRECTIONS, type Direction, type Maze } from "~/maze/format";
import { cellKey } from "~/maze/geometry";
import { applyMove, initialRunState } from "~/maze/reduce";
import {
  advanceRun,
  emptyMap,
  freshRun,
  heldKeys,
  pathFrom,
  recordDelta,
} from "~/maze/run";

/**
 * Three cells in a row with the start in the middle, a key to the west and a
 * gate to the east. The runner can walk west, bump the boundary, come back,
 * and open the gate, which exercises every kind of reveal on a board small
 * enough to check by eye.
 */
function corridor(): Maze {
  return {
    version: 1,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
    start: { x: 1, y: 0 },
    treasure: { x: 3, y: 0 },
    segments: [{ o: "V", x: 1, y: 0, kind: "gate", gate: 1 }],
    keys: [{ gate: 1, x: 0, y: 0 }],
  };
}

function walk(maze: Maze, dirs: readonly Direction[]) {
  let run = freshRun(maze);
  const deltas = [];
  for (const dir of dirs) {
    const step = advanceRun(run, maze, dir);
    run = step.run;
    deltas.push(step.delta);
  }
  return { run, deltas };
}

describe("emptyMap", () => {
  it("knows only the start cell, at the origin", () => {
    expect(emptyMap()).toEqual({ cells: [{ x: 0, y: 0 }], segments: [] });
  });
});

describe("recordDelta", () => {
  it("adds the cell entered, in the start-relative frame", () => {
    const { run } = walk(corridor(), ["W"]);
    expect(run.view.map.cells).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0, key: 1 },
    ]);
    expect(run.view.at).toEqual({ x: -1, y: 0 });
  });

  it("records a bumped gate once, however often it is bumped", () => {
    const { run } = walk(corridor(), ["E", "E", "E"]);
    expect(run.view.map.segments).toEqual([
      { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
    ]);
    expect(run.state.penalties).toBe(3);
  });

  it("does not lose a cell's key when the cell is revisited", () => {
    const { run } = walk(corridor(), ["W", "E", "W"]);
    const keyed = run.view.map.cells.find((c) => c.x === -1);
    expect(keyed).toEqual({ x: -1, y: 0, key: 1 });
    expect(run.view.map.cells).toHaveLength(2);
  });

  it("records a wall and a boundary identically", () => {
    // West of the key cell is off the shape; the runner must not be able to
    // tell from the map that no square is there.
    const { run } = walk(corridor(), ["W", "W"]);
    expect(run.view.map.segments).toEqual([
      { o: "V", x: -2, y: 0, kind: "wall" },
    ]);
  });

  it("returns a new map and leaves the old one alone", () => {
    const map = emptyMap();
    const maze = corridor();
    const { delta } = applyMove(maze, initialRunState(maze), "W");
    const next = recordDelta(map, delta);
    expect(next).not.toBe(map);
    expect(map).toEqual(emptyMap());
  });
});

describe("heldKeys", () => {
  it("is every key on a revealed cell, in gate order", () => {
    expect(heldKeys(emptyMap())).toEqual([]);
    expect(heldKeys(walk(corridor(), ["W"]).run.view.map)).toEqual([1]);
  });
});

describe("pathFrom", () => {
  it("starts at the origin and adds a point only for moves that moved", () => {
    const { deltas } = walk(corridor(), ["W", "W", "E", "E", "E"]);
    // W (key), W (bump: no point), E (back to start), E (through the gate,
    // now held), E (treasure).
    expect(pathFrom(deltas)).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("is just the origin for a run with no moves", () => {
    expect(pathFrom([])).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("advanceRun", () => {
  it("keeps the absolute state and the relative view in step", () => {
    const maze = corridor();
    const { run } = walk(maze, ["W", "E", "E"]);
    expect(run.state.at).toEqual({ x: 2, y: 0 });
    expect(run.view.at).toEqual({
      x: run.state.at.x - maze.start.x,
      y: run.state.at.y - maze.start.y,
    });
  });
});

describe("the map holds nothing the runner has not touched", () => {
  it("contains exactly the cells stood on, for any walk", () => {
    const maze = corridor();
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Direction>(...DIRECTIONS), { maxLength: 40 }),
        (dirs) => {
          const { run, deltas } = walk(maze, dirs);
          const stoodOn = new Set(pathFrom(deltas).map(cellKey));
          const mapped = new Set(run.view.map.cells.map(cellKey));
          expect(mapped).toEqual(stoodOn);
        },
      ),
    );
  });

  it("contains exactly the segments bumped or crossed, for any walk", () => {
    const maze = corridor();
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Direction>(...DIRECTIONS), { maxLength: 40 }),
        (dirs) => {
          const { run, deltas } = walk(maze, dirs);
          const revealed = new Set(
            deltas.flatMap((d) =>
              d.revealedSegment
                ? [`${d.revealedSegment.o}:${d.revealedSegment.x},${d.revealedSegment.y}`]
                : [],
            ),
          );
          const mapped = new Set(
            run.view.map.segments.map((s) => `${s.o}:${s.x},${s.y}`),
          );
          expect(mapped).toEqual(revealed);
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/unit/maze/run.test.ts`
Expected: FAIL, `Failed to resolve import "~/maze/run"`.

- [ ] **Step 3: Add `SERVER_OUTCOMES` to `src/maze/reduce.ts`**

Replace the `ServerOutcome` union with a runtime list, so the `move.outcome` column (Task 3) can use it as a Drizzle enum without a second copy of the spelling:

```ts
/** Spec §7. `blocked_boundary` is server-side only — see RunnerDelta. */
export const SERVER_OUTCOMES = [
  "moved",
  "moved_found_key",
  "moved_found_treasure",
  "moved_through_gate",
  "blocked_wall",
  "blocked_gate",
  "blocked_boundary",
] as const;

export type ServerOutcome = (typeof SERVER_OUTCOMES)[number];
```

- [ ] **Step 4: Write `src/maze/run.ts`**

```ts
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
```

Add `export * from "./run";` to `src/maze/index.ts` beside the other re-exports.

- [ ] **Step 5: Run the tests**

Run: `pnpm test tests/unit/maze/run.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Break it and watch it fail**

In `recordDelta`, change the merge to `{ ...cell }` (replace instead of merge). The test "does not lose a cell's key when the cell is revisited" must **still pass**, because the reducer re-reports the key, and that is the point of the comment. Then delete the `if (d.at.x !== …)` guard in `pathFrom`. Both `pathFrom` tests and the first property test must fail. Restore both changes.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add src/maze tests/unit/maze/run.test.ts
git commit -m "feat: add the runner's discovered map and stored run"
```

---

## Task 2: Completion, scoring, and the missing deadline row

**Files:**
- Create: `src/match/completion.ts`, `tests/unit/match/completion.test.ts`
- Modify: `src/match/deadline.ts`, `src/match/index.ts`, `tests/unit/match/deadline.test.ts`, `AGENTS.md` (invariant 7)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type RunFacts = { userId: string; startedAt: Date | null; finishedAt: Date | null; gaveUpAt: Date | null; penalties: number; moves: number }`
  - `elapsedMs(run: RunFacts): number | null`
  - `type DecidingField = "penalties" | "moves" | "time"`
  - `decidingField(a: RunFacts, b: RunFacts): DecidingField | null`. Null for a perfect tie or when either run is unfinished.
  - `type Completion = { kind: "none" } | { kind: "complete"; winnerId: string | null; endReason: "finished" | "forfeit" }`
  - `resolveCompletion(players: readonly RunFacts[]): Completion`
  - `deadlineFor` and `resolveExpiry`, same signatures, now implementing §9.1 row 6.

### The deadline gap

Spec §9.1 has seven rows. The sixth ("one has moved, the other has not: 24h from the later of the mover's last move and the unlocking, recorded against the player who never moved") was added during Phase 3, but `deadlineFor` was never updated. Nobody could move in Phase 3, so the gap was invisible. In Phase 4 it is live: a match where one player is actively running would fall through to row 4 and abandon at a fixed 24h from the unlocking, blaming nobody. The code comments also number the finish row "row 6", but in the spec's current table it is row 7. This task renumbers them.

- [ ] **Step 1: Write the failing completion tests**

`tests/unit/match/completion.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decidingField,
  elapsedMs,
  resolveCompletion,
  type RunFacts,
} from "~/match";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function run(over: Partial<RunFacts> = {}): RunFacts {
  return {
    userId: "a",
    startedAt: null,
    finishedAt: null,
    gaveUpAt: null,
    penalties: 0,
    moves: 0,
    ...over,
  };
}

function finished(
  userId: string,
  penalties: number,
  moves: number,
  elapsed: number,
): RunFacts {
  return run({
    userId,
    penalties,
    moves,
    startedAt: at(1000),
    finishedAt: at(1000 + elapsed),
  });
}

describe("elapsedMs", () => {
  it("runs from the first move to the finish", () => {
    expect(elapsedMs(finished("a", 0, 1, 4500))).toBe(4500);
  });

  it("is null for a run that has not finished", () => {
    expect(elapsedMs(run({ startedAt: at(1) }))).toBeNull();
  });
});

describe("resolveCompletion", () => {
  it("waits while either run is unfinished", () => {
    expect(
      resolveCompletion([finished("a", 0, 10, 10), run({ userId: "b" })]),
    ).toEqual({ kind: "none" });
  });

  it("waits with only one player seated", () => {
    expect(resolveCompletion([finished("a", 0, 10, 10)])).toEqual({
      kind: "none",
    });
  });

  it("gives the win to fewer penalties, whatever the moves and time", () => {
    expect(
      resolveCompletion([finished("a", 3, 10, 10), finished("b", 2, 99, 99)]),
    ).toEqual({ kind: "complete", winnerId: "b", endReason: "finished" });
  });

  it("breaks a penalty tie on moves", () => {
    expect(
      resolveCompletion([finished("a", 2, 12, 10), finished("b", 2, 14, 1)]),
    ).toEqual({ kind: "complete", winnerId: "a", endReason: "finished" });
  });

  it("breaks a penalty and move tie on elapsed time", () => {
    expect(
      resolveCompletion([finished("a", 2, 12, 900), finished("b", 2, 12, 800)]),
    ).toEqual({ kind: "complete", winnerId: "b", endReason: "finished" });
  });

  it("completes a perfect tie with no winner", () => {
    expect(
      resolveCompletion([finished("a", 2, 12, 800), finished("b", 2, 12, 800)]),
    ).toEqual({ kind: "complete", winnerId: null, endReason: "finished" });
  });

  it("awards a give-up to the opponent who has not moved at all", () => {
    expect(
      resolveCompletion([
        run({ userId: "a", gaveUpAt: at(5), startedAt: at(1), moves: 3 }),
        run({ userId: "b" }),
      ]),
    ).toEqual({ kind: "complete", winnerId: "b", endReason: "forfeit" });
  });

  it("awards a give-up to an opponent who already finished", () => {
    expect(
      resolveCompletion([
        finished("a", 9, 40, 100),
        run({ userId: "b", gaveUpAt: at(5) }),
      ]),
    ).toEqual({ kind: "complete", winnerId: "a", endReason: "forfeit" });
  });

  it("always names the other player when someone gives up", () => {
    const arbRun = (userId: string) =>
      fc.record({
        userId: fc.constant(userId),
        startedAt: fc.option(fc.constant(at(1)), { nil: null }),
        finishedAt: fc.option(fc.constant(at(9)), { nil: null }),
        gaveUpAt: fc.constant(null),
        penalties: fc.nat(50),
        moves: fc.nat(500),
      });
    fc.assert(
      fc.property(arbRun("a"), arbRun("b"), fc.boolean(), (a, b, aQuits) => {
        const players = aQuits
          ? [{ ...a, gaveUpAt: at(5), finishedAt: null }, b]
          : [a, { ...b, gaveUpAt: at(5), finishedAt: null }];
        const outcome = resolveCompletion(players);
        expect(outcome).toEqual({
          kind: "complete",
          winnerId: aQuits ? "b" : "a",
          endReason: "forfeit",
        });
      }),
    );
  });

  it("never completes as finished unless both reached the treasure", () => {
    const arbRun = (userId: string) =>
      fc.record({
        userId: fc.constant(userId),
        startedAt: fc.option(fc.constant(at(1)), { nil: null }),
        finishedAt: fc.option(fc.constant(at(9)), { nil: null }),
        gaveUpAt: fc.constant(null),
        penalties: fc.nat(50),
        moves: fc.nat(500),
      });
    fc.assert(
      fc.property(arbRun("a"), arbRun("b"), (a, b) => {
        const outcome = resolveCompletion([a, b]);
        if (outcome.kind === "complete" && outcome.endReason === "finished") {
          expect(a.finishedAt).not.toBeNull();
          expect(b.finishedAt).not.toBeNull();
        }
      }),
    );
  });

  it("ranks the same regardless of seat order", () => {
    const arbFinished = (userId: string) =>
      fc
        .tuple(fc.nat(5), fc.nat(5), fc.nat(5))
        .map(([p, m, t]) => finished(userId, p, m, t));
    fc.assert(
      fc.property(arbFinished("a"), arbFinished("b"), (a, b) => {
        expect(resolveCompletion([a, b])).toEqual(resolveCompletion([b, a]));
      }),
    );
  });
});

describe("decidingField", () => {
  it("names the first field that differs", () => {
    expect(decidingField(finished("a", 1, 9, 9), finished("b", 2, 9, 9))).toBe(
      "penalties",
    );
    expect(decidingField(finished("a", 2, 9, 9), finished("b", 2, 8, 9))).toBe(
      "moves",
    );
    expect(decidingField(finished("a", 2, 8, 7), finished("b", 2, 8, 9))).toBe(
      "time",
    );
  });

  it("is null for a perfect tie, or when either run is unfinished", () => {
    expect(
      decidingField(finished("a", 2, 8, 9), finished("b", 2, 8, 9)),
    ).toBeNull();
    expect(decidingField(finished("a", 2, 8, 9), run({ userId: "b" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Add the failing deadline tests**

In `tests/unit/match/deadline.test.ts`:

1. Rename the two tests titled `row 6: one found the treasure …` and `row 6 outranks row 5 …` to `row 7: …` and `row 7 outranks row 5 …`, so they match the spec's current table. Rename the `resolveExpiry` test `gives the finisher the win …` unchanged in body.
2. Add after the row 5 test:

```ts
  it("row 6: one has moved, the other has not — 24h from the mover's last move", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(50_000),
      players: [
        player({ userId: "a", submittedAt: at(7000), lastMoveAt: at(50_000) }),
        player({ userId: "b", submittedAt: at(8000) }),
      ],
    });
    // Not 24h from the unlocking: a player who is moving is engaged, and
    // nothing expires from under an engaged player.
    expect(deadlineFor(s)).toEqual(at(50_000 + HOURS_24_MS));
  });
```

3. Add to `describe("resolveExpiry")`:

```ts
  it("records the one-moved forfeit against the player who never moved", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(50_000),
      players: [
        player({ userId: "a", submittedAt: at(7000), lastMoveAt: at(50_000) }),
        player({ userId: "b", submittedAt: at(8000) }),
      ],
    });
    expect(resolveExpiry(s, at(50_000 + HOURS_24_MS))).toEqual({
      kind: "abandoned",
      forfeitedBy: ["b"],
    });
  });

  it("blames nobody when both moved and both went quiet", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(20_000),
      players: [
        player({ userId: "a", submittedAt: at(7000), lastMoveAt: at(12_000) }),
        player({ userId: "b", submittedAt: at(8000), lastMoveAt: at(20_000) }),
      ],
    });
    expect(resolveExpiry(s, at(20_000 + HOURS_48_MS))).toEqual({
      kind: "abandoned",
      forfeitedBy: [],
    });
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm test tests/unit/match`
Expected: FAIL. `completion.test.ts` cannot resolve `decidingField` and friends. The row 6 test returns `at(8000 + HOURS_24_MS)` (it fell through to row 4), and the one-moved blame test returns `forfeitedBy: []`.

- [ ] **Step 4: Write `src/match/completion.ts`**

```ts
/**
 * What the completion rules need to know about one player's run. Built from
 * a `match_player` row by the server; plain data here.
 */
export type RunFacts = {
  userId: string;
  /** The first move. Null until the runner has moved. */
  startedAt: Date | null;
  /** The move that reached the treasure. */
  finishedAt: Date | null;
  /** Spec §9.2. */
  gaveUpAt: Date | null;
  penalties: number;
  moves: number;
};

export type DecidingField = "penalties" | "moves" | "time";

export type Completion =
  | { kind: "none" }
  | {
      kind: "complete";
      /** Null only for a perfect tie (spec §2.6). */
      winnerId: string | null;
      endReason: "finished" | "forfeit";
    };

/**
 * Spec §2.6: from the runner's first move to the move that reached the
 * treasure. Not from the unlocking — runs are asynchronous, and a player who
 * starts a day later has not been slower.
 */
export function elapsedMs(run: RunFacts): number | null {
  if (run.startedAt === null || run.finishedAt === null) return null;
  return run.finishedAt.getTime() - run.startedAt.getTime();
}

/** Negative when `a` ranks ahead, positive when `b` does, zero for a tie. */
function compareFinished(a: RunFacts, b: RunFacts): number {
  return (
    a.penalties - b.penalties ||
    a.moves - b.moves ||
    elapsedMs(a)! - elapsedMs(b)!
  );
}

/** Which tiebreaker settled it, for the result screen's "decided on …" line. */
export function decidingField(a: RunFacts, b: RunFacts): DecidingField | null {
  if (elapsedMs(a) === null || elapsedMs(b) === null) return null;
  if (a.penalties !== b.penalties) return "penalties";
  if (a.moves !== b.moves) return "moves";
  if (elapsedMs(a) !== elapsedMs(b)) return "time";
  return null;
}

/**
 * Whether a running match is over, on anything other than a deadline — the
 * deadline rules are `resolveExpiry`'s, and the two never disagree, because
 * a match this function completes is terminal and `resolveExpiry` ignores
 * terminal matches.
 *
 * A give-up decides it immediately for the other player, finished or not
 * (spec §9.2). That is the one way to win without the treasure, and it is
 * deliberate: a concession is not silence. Otherwise both runs must have
 * reached the treasure, and §2.6 ranks them.
 */
export function resolveCompletion(players: readonly RunFacts[]): Completion {
  if (players.length !== 2) return { kind: "none" };
  const [a, b] = players as readonly [RunFacts, RunFacts];

  const quitter = [a, b].find((p) => p.gaveUpAt !== null);
  if (quitter) {
    const winner = quitter === a ? b : a;
    return { kind: "complete", winnerId: winner.userId, endReason: "forfeit" };
  }

  if (a.finishedAt === null || b.finishedAt === null) return { kind: "none" };

  const order = compareFinished(a, b);
  return {
    kind: "complete",
    endReason: "finished",
    winnerId: order < 0 ? a.userId : order > 0 ? b.userId : null,
  };
}
```

Add `export * from "./completion";` to `src/match/index.ts`.

- [ ] **Step 5: Fix `src/match/deadline.ts`**

1. In `deadlineFor`, rename the `// Row 6 — one found the treasure` comment to `// Row 7`, and update the doc comment's "A finish (row 6) outranks …" to "row 7". Then insert between the row 5 block and the row 4 block:

```ts
  // Row 6 — one has moved, the other has not. Anchored to the mover, not to
  // the unlocking: a player who is moving is engaged, and nothing expires
  // from under an engaged player. The clock runs against the one who has
  // not started.
  if (moved.length === 1 && players.length === 2 && situation.unlockedAt) {
    const anchor = Math.max(
      moved[0]!.lastMoveAt!.getTime(),
      situation.unlockedAt.getTime(),
    );
    return plus(new Date(anchor), HOURS_24_MS);
  }
```

2. In `resolveExpiry`, rename `// Row 6 — the only row that produces a winner` to `// Row 7`.

3. Replace `blameFor` with:

```ts
/**
 * Who missed the deadline. Nobody is at fault when a match simply went
 * unjoined, or when both players went quiet together — fault is only
 * recorded where one player was waiting on another: one drew and the other
 * did not (row 3), or one ran and the other never started (row 6).
 */
function blameFor(situation: MatchSituation): readonly string[] {
  const { players } = situation;
  if (players.length < 2) return [];

  const submitted = players.filter((p) => p.submittedAt !== null);
  if (submitted.length === 1) {
    return players.filter((p) => p.submittedAt === null).map((p) => p.userId);
  }

  const moved = players.filter((p) => p.lastMoveAt !== null);
  if (situation.status === "running" && moved.length === 1) {
    return players.filter((p) => p.lastMoveAt === null).map((p) => p.userId);
  }

  return [];
}
```

4. Update the `PlayerSituation` field comments from "Phase 4 fills this. Null throughout Phase 3." to "The runner's latest move." and "The move that reached the treasure."

- [ ] **Step 6: Amend invariant 7 in `AGENTS.md`**

Replace invariant 7 with:

```markdown
7. **You cannot win without finding the treasure — unless your opponent gives
   up.** Expiry never produces a winner who did not reach the treasure, and
   `winnerId` is null for every `abandoned` match. Giving up (spec §9.2) is
   the one exception: it is a concession, not silence, and it awards the match
   to the other player whether or not they have finished.
   `resolveCompletion` in `src/match/completion.ts` is the only code that
   decides a win outside the sweep.
```

- [ ] **Step 7: Run the tests**

Run: `pnpm test tests/unit/match`
Expected: PASS. `completion.test.ts` has 15 tests, and `deadline.test.ts` gains 3.

- [ ] **Step 8: Break it and watch it fail**

Swap `a.moves - b.moves` and the elapsed comparison in `compareFinished`. "breaks a penalty tie on moves" must fail. Then delete the row 6 block in `deadlineFor`. The row 6 test must fail. Restore both.

- [ ] **Step 9: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add src/match tests/unit/match AGENTS.md
git commit -m "feat: decide completed matches, and add the one-moved deadline row"
```

---

## Task 3: The run schema

**Files:**
- Modify: `src/server/db/schema/match.ts`, `src/server/match/situation.ts`, `src/server/api/routers/match.ts`
- Create: `src/server/match/access.ts`, `drizzle/0005_*.sql` (generated), `tests/integration/run-schema.test.ts`
- Modify: `docs/superpowers/specs/2026-09-22-labyrinth-design.md` (§6, §7)

**Interfaces:**
- Consumes: `StoredRun`, `RunnerDelta`, `SERVER_OUTCOMES`, `DIRECTIONS` from `~/maze`.
- Produces:
  - `matchPlayer` columns: `runState: StoredRun | null`, `startedAt`, `lastMoveAt`, `finishedAt`, `gaveUpAt: Date | null`
  - table `move`: `id`, `matchId`, `runnerId`, `seq`, `dir`, `outcome`, `delta: RunnerDelta`, `createdAt`; unique `(matchId, runnerId, seq)`
  - `~/server/match/access`: `type DbClient`, `participantRows(tx: DbClient, matchId: string, userId: string, options?: { lock?: boolean })`, `notYours(): never`
  - `situationFor` now passes `lastMoveAt` and `finishedAt` through.

- [ ] **Step 1: Write the failing schema test**

`tests/integration/run-schema.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match, matchPlayer, move } from "~/server/db/schema";

async function signedIn() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

async function seatedMatch() {
  const ctx = await signedIn();
  const created = await createCaller(ctx).match.create({
    cellCount: 36,
    gateCount: 0,
  });
  return { matchId: created.id, userId: ctx.session!.user.id };
}

const delta = {
  outcome: "moved" as const,
  from: { x: 0, y: 0 },
  at: { x: 1, y: 0 },
  penalties: 0,
  moves: 1,
  finished: false,
};

describe("the move table", () => {
  it("refuses a second move with the same seq for the same runner", async () => {
    const { matchId, userId } = await seatedMatch();
    const row = {
      matchId,
      runnerId: userId,
      seq: 1,
      dir: "E" as const,
      outcome: "moved" as const,
      delta,
    };
    await db.insert(move).values(row);
    await expect(db.insert(move).values(row)).rejects.toThrow(
      /move_runner_seq_unique/,
    );
  });

  it("goes with its match", async () => {
    const { matchId, userId } = await seatedMatch();
    await db.insert(move).values({
      matchId,
      runnerId: userId,
      seq: 1,
      dir: "E",
      outcome: "moved",
      delta,
    });
    await db.delete(match).where(eq(match.id, matchId));
    const left = await db.select().from(move).where(eq(move.matchId, matchId));
    expect(left).toEqual([]);
  });
});

describe("match_player run columns", () => {
  it("refuses a run that both finished and gave up", async () => {
    const { matchId } = await seatedMatch();
    const now = new Date();
    await expect(
      db
        .update(matchPlayer)
        .set({ finishedAt: now, gaveUpAt: now })
        .where(eq(matchPlayer.matchId, matchId)),
    ).rejects.toThrow(/match_player_finished_or_gave_up/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:integration tests/integration/run-schema.test.ts`
Expected: FAIL. `move` is not exported from `~/server/db/schema`.

- [ ] **Step 3: Extend `src/server/db/schema/match.ts`**

Add `jsonb` and `unique` to the `drizzle-orm/pg-core` import, plus:

```ts
import {
  DIRECTIONS,
  SERVER_OUTCOMES,
  type RunnerDelta,
  type StoredRun,
} from "~/maze";
```

Replace the `matchPlayer` doc comment's last two sentences ("The run columns … nothing reads or writes them yet.") with:

```ts
 * The run columns are Phase 4's. There is no `runStatus`: not started,
 * running, finished and gave up are `startedAt`, `finishedAt` and `gaveUpAt`
 * being null or not, and a stored copy would be a second source of truth.
 * Penalties and the move count live inside `runState`, beside the position
 * they belong with. `runState` is a cache of the move log (AGENTS.md
 * invariant 4) and is written in the same transaction as each move.
 *
 * `gaveUpAt` is not `forfeitedAt`: the sweep sets `forfeitedAt` on a player
 * who ran out of time, and the result screen has to tell the two apart.
```

Add the columns to `matchPlayer`, after `forfeitedAt`:

```ts
    runState: jsonb("run_state").$type<StoredRun>(),
    startedAt: timestamp("started_at"),
    lastMoveAt: timestamp("last_move_at"),
    finishedAt: timestamp("finished_at"),
    gaveUpAt: timestamp("gave_up_at"),
```

And to its table callback:

```ts
    // A run ends one way. Giving up after the treasure is refused by
    // `run.giveUp`; this is what makes that refusal more than a convention.
    check(
      "match_player_finished_or_gave_up",
      sql`${table.finishedAt} IS NULL OR ${table.gaveUpAt} IS NULL`,
    ),
```

Append the `move` table:

```ts
/**
 * Spec §6 and §7. The move log is the source of truth (AGENTS.md invariant
 * 4); `match_player.runState` is its cache.
 *
 * `outcome` is the server's, and so may be `blocked_boundary`. `delta` is
 * exactly what the runner was sent — `blocked_boundary` already collapsed to
 * `blocked_wall` — because it is what a retried request must get back
 * (§7.2) and what replay will read (§8). Storing the runner's delta rather
 * than re-deriving it means a retry can never disclose more than the
 * original answer did.
 */
export const move = pgTable(
  "move",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    matchId: text("match_id")
      .notNull()
      .references(() => match.id, { onDelete: "cascade" }),
    runnerId: text("runner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    dir: text("dir", { enum: DIRECTIONS }).notNull(),
    outcome: text("outcome", { enum: SERVER_OUTCOMES }).notNull(),
    delta: jsonb("delta").$type<RunnerDelta>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // §7.2. Also the index every per-runner read of the log uses.
    unique("move_runner_seq_unique").on(
      table.matchId,
      table.runnerId,
      table.seq,
    ),
  ],
);
```

- [ ] **Step 4: Generate and read the migration**

Run: `pnpm db:generate`

Open the new `drizzle/0005_*.sql`. It must contain only `ALTER TABLE "match_player" ADD COLUMN …` (five), one `ADD CONSTRAINT … CHECK`, one `CREATE TABLE "move"`, its foreign keys and the unique constraint. **Any `DROP` or `RENAME` is a defect**: the migration must be additive (Global Constraints). Then run `pnpm db:migrate` against your `dev` branch.

- [ ] **Step 5: Move the shared access helpers into `src/server/match/access.ts`**

```ts
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { type NeonQueryResultHKT } from "drizzle-orm/neon-serverless";
import { type PgDatabase } from "drizzle-orm/pg-core";

import { match, matchPlayer } from "~/server/db/schema";
import type * as schema from "~/server/db/schema";

/**
 * Both the pooled client and an open transaction on it satisfy this, so a
 * helper can be called inside or outside one. `typeof db` would not do: a
 * transaction object lacks `$client`.
 */
export type DbClient = PgDatabase<NeonQueryResultHKT, typeof schema>;

/**
 * Every read of a match the caller must be part of.
 *
 * `lock` takes `FOR UPDATE` on the match row and both player rows, which is
 * what serialises everything that can change a running match — two moves on
 * the same `seq`, a move racing the opponent's give-up, both players
 * finishing at once. The match row is locked first, always, so two
 * transactions on the same match can never wait on each other in opposite
 * orders. It only means anything inside a transaction.
 */
export async function participantRows(
  tx: DbClient,
  matchId: string,
  userId: string,
  options: { lock?: boolean } = {},
) {
  const matchQuery = tx.select().from(match).where(eq(match.id, matchId));
  const [row] = await (options.lock ? matchQuery.for("update") : matchQuery);
  if (!row) return null;

  const playersQuery = tx
    .select()
    .from(matchPlayer)
    .where(eq(matchPlayer.matchId, matchId));
  const players = await (options.lock
    ? playersQuery.for("update")
    : playersQuery);
  if (!players.some((p) => p.userId === userId)) return null;

  return { row, players };
}

/**
 * A match the caller is not in and a match that does not exist get the same
 * answer: distinguishing them would confirm the match exists to someone with
 * no business knowing.
 */
export function notYours(): never {
  throw new TRPCError({ code: "FORBIDDEN", message: "errors.notYourMatch" });
}
```

In `src/server/api/routers/match.ts`, delete the local `DbClient` type and its comment, `participantRows` and `notYours`, and import all three from `~/server/match/access`. Drop the imports that become unused (`NeonQueryResultHKT`, `PgDatabase`, `schema`). `join` builds a literal `PlayerRow`, so add the five new fields to it as `null`: `runState`, `startedAt`, `lastMoveAt`, `finishedAt`, `gaveUpAt`.

- [ ] **Step 6: Feed the run timestamps into `situationFor`**

In `src/server/match/situation.ts`, change the two hardcoded nulls to `lastMoveAt: p.lastMoveAt` and `finishedAt: p.finishedAt`. Replace the paragraph beginning "`lastMoveAt` and `finishedAt` are hardcoded null" with:

```ts
 * `lastMoveAt` and `finishedAt` come straight off the player rows; with
 * them, every row of §9.1 is reachable through this bridge.
```

Remove the "Phase 3 note" paragraph from `sweepExpiredMatches`'s doc comment in `src/server/match/sweep.ts`. The `complete` branch is now reachable, and Task 6 tests it.

- [ ] **Step 7: Write the deviations back into the spec**

In `docs/superpowers/specs/2026-09-22-labyrinth-design.md`:

- §6, the `match_player` entry of the code block becomes:

```
match_player    matchId, userId, mazeId,          -- the maze THEY drew
                joinedAt, submittedAt, forfeitedAt nullable,
                runState jsonb, startedAt, lastMoveAt, finishedAt,
                gaveUpAt nullable
                primary key (matchId, userId)
```

  and the `move` entry's `revealed jsonb` becomes `delta jsonb`.
- §6, after the `runState` paragraph, add: "There is no `runStatus` column: not started, running, finished and gave up are `startedAt`, `finishedAt` and `gaveUpAt` being set or not, and penalties and the move count live inside `runState`. Phase 4 settled both, for the same reason Phase 3 left out a stored unlock time: a copy of a derivable value is a second source of truth. `move.delta` stores the runner's delta verbatim, which is what a retry must get back (§7.2)."
- §7, the first line `match.move({ matchId, seq, dir })` becomes `run.move({ matchId, seq, dir })`. Add one sentence after the numbered list: "The run's procedures (`run.get`, `run.move`, `run.giveUp`, `run.result`) live on their own router."

- [ ] **Step 8: Run the tests**

Run: `pnpm test:integration`
Expected: PASS, including the 3 new tests. Every existing router and sweep test still passes, which proves the helper move changed nothing.

- [ ] **Step 9: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add src/server drizzle tests/integration/run-schema.test.ts docs/superpowers/specs
git commit -m "feat: add the move log and run columns"
```

---

## Task 4: A seeded labyrinth with a key, a gate and a wall

**Files:**
- Modify: `src/lib/open-maze.ts`, `src/server/api/routers/test-support.ts`, `tests/fixtures/maze.ts`, `e2e/support/match.ts`
- Create: `tests/unit/gated-maze.test.ts`

**Interfaces:**
- Consumes: `validateMaze`, `advanceRun`, `freshRun`, `mazeSchema` from `~/maze`.
- Produces:
  - `gatedMazeDraft(): DraftMaze`: 36 cells, 1 gate.
  - `GATED_MAZE_ROUTE: readonly Direction[]`: 11 moves, 1 penalty, reaching the treasure.
  - `GATED_MAZE_CELL_COUNT = 36`, `GATED_MAZE_GATE_COUNT = 1`
  - `testSupport.seedMaze` input becomes a discriminated union on `layout: "open" | "gated"`. `"open"` is the default, so Phase 3 callers are unchanged.
  - `tests/fixtures/maze.ts` re-exports `gatedMazeDraft`, `GATED_MAZE_ROUTE`, `GATED_MAZE_CELL_COUNT`, `GATED_MAZE_GATE_COUNT`.
  - `e2e/support/match.ts`: `PlayerOptions` gains an optional `layout`.

The open seed has no walls, no gates and no keys, so the §12 e2e run ("bumps a wall, collects a key, opens its gate, reaches the treasure") has nothing to bump. This adds the smallest maze that has all three.

```
 start ▸ S . . . . .     row 0
         . . . . . .     row 1
         K . . . . .     row 2   K = key 1
         ═ ═ ═ ═ ═ ┅     walls under columns 0–4; gate 1 under column 5
         . . . . . .     row 3
         . . . . . .     row 4
         . . . . . T     row 5   T = treasure
```

The route: S, S (key), S (bump the wall: 1 penalty), E ×5, S (through the gate), S, S (treasure).

- [ ] **Step 1: Write the failing test**

`tests/unit/gated-maze.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  GATED_MAZE_ROUTE,
  gatedMazeDraft,
} from "~/lib/open-maze";
import { advanceRun, freshRun, mazeSchema, validateMaze } from "~/maze";

describe("gatedMazeDraft", () => {
  it("validates at its own settings", () => {
    const result = validateMaze(gatedMazeDraft(), {
      cellCount: GATED_MAZE_CELL_COUNT,
      gateCount: GATED_MAZE_GATE_COUNT,
    });
    expect(result.ok).toBe(true);
  });

  it("is solved by its route with one wall bump, a key and the gate", () => {
    const maze = mazeSchema.parse(gatedMazeDraft());
    let run = freshRun(maze);
    const outcomes = [];
    for (const dir of GATED_MAZE_ROUTE) {
      const step = advanceRun(run, maze, dir);
      run = step.run;
      outcomes.push(step.outcome);
    }
    expect(outcomes).toEqual([
      "moved",
      "moved_found_key",
      "blocked_wall",
      "moved",
      "moved",
      "moved",
      "moved",
      "moved",
      "moved_through_gate",
      "moved",
      "moved_found_treasure",
    ]);
    expect(run.state.penalties).toBe(1);
    expect(run.state.moves).toBe(11);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/gated-maze.test.ts`
Expected: FAIL, `gatedMazeDraft` is not exported.

- [ ] **Step 3: Add the maze to `src/lib/open-maze.ts`**

Add `Direction` to the type import from `~/maze`, then append:

```ts
export const GATED_MAZE_CELL_COUNT = 36;
export const GATED_MAZE_GATE_COUNT = 1;

/**
 * The open 6×6 labyrinth with a wall across it under row 2, gate 1 in that
 * wall at the far east end, and its key at the west end of row 2. It is the
 * smallest seed with something to bump, something to collect and something
 * to open, which is what the run's end-to-end spec walks through (spec §12).
 * `GATED_MAZE_ROUTE` solves it.
 */
export function gatedMazeDraft(): DraftMaze {
  const open = openMazeDraft(GATED_MAZE_CELL_COUNT);
  return {
    ...open,
    segments: [
      ...[0, 1, 2, 3, 4].map((x) => ({
        o: "H" as const,
        x,
        y: 2,
        kind: "wall" as const,
      })),
      { o: "H", x: 5, y: 2, kind: "gate", gate: 1 },
    ],
    keys: [{ gate: 1, x: 0, y: 2 }],
  };
}

/** S, S onto the key, S into the wall, east along row 2, S through the gate to the treasure. */
export const GATED_MAZE_ROUTE: readonly Direction[] = [
  "S",
  "S",
  "S",
  "E",
  "E",
  "E",
  "E",
  "E",
  "S",
  "S",
  "S",
];
```

Update the file's top doc comment from "An open square labyrinth …" to cover both seeds: "Seed labyrinths for tests: an open square one, and a gated one with a wall, a gate and a key."

- [ ] **Step 4: Teach `seedMaze` the layout**

In `src/server/api/routers/test-support.ts`, import `gatedMazeDraft`, `GATED_MAZE_CELL_COUNT` and `GATED_MAZE_GATE_COUNT`. Replace the input with:

```ts
    .input(
      z.discriminatedUnion("layout", [
        z.object({
          layout: z.literal("open"),
          name: z.string().trim().min(1).max(80),
          cellCount: z
            .number()
            .int()
            .refine(
              (n): n is (typeof CELL_COUNT_PRESETS)[number] =>
                (CELL_COUNT_PRESETS as readonly number[]).includes(n),
              { message: "maze.format.cellCountNotAPreset" },
            ),
          gateCount: z.literal(0),
        }),
        // The gated seed exists at one size only. A generator that placed
        // gates at every size is speculative work nothing has asked for.
        z.object({
          layout: z.literal("gated"),
          name: z.string().trim().min(1).max(80),
          cellCount: z.literal(GATED_MAZE_CELL_COUNT),
          gateCount: z.literal(GATED_MAZE_GATE_COUNT),
        }),
      ]),
    )
```

zod's `discriminatedUnion` does not fill in a default discriminator. So preprocess the raw input to add `layout: "open"` when it is absent, keeping existing Phase 3 callers working:

```ts
const withDefaultLayout = (input: unknown) =>
  typeof input === "object" && input !== null && !("layout" in input)
    ? { ...input, layout: "open" }
    : input;
```

and wrap the union with `z.preprocess(withDefaultLayout, …)`. In the mutation, pick the generator with `const data = input.layout === "gated" ? gatedMazeDraft() : openMazeDraft(input.cellCount);`. Update the comment above the old `gateCount: z.literal(0)` to explain the two layouts, dropping the "Gated seeding is not supported" sentence.

- [ ] **Step 5: Re-export from the fixtures, and thread the layout through e2e**

In `tests/fixtures/maze.ts`, add:

```ts
export {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  GATED_MAZE_ROUTE,
  gatedMazeDraft,
} from "~/lib/open-maze";
```

In `e2e/support/match.ts`, change `PlayerOptions` to `{ name: string; cellCount: number; gateCount: number; layout?: "open" | "gated" }`. The seed call already passes `options` straight through.

- [ ] **Step 6: Run the tests**

Run: `pnpm test`
Expected: PASS, including 2 new tests. Then `pnpm test:integration`: every existing caller of `seedMaze` and of the fixtures still passes.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add src/lib src/server/api/routers/test-support.ts tests e2e/support
git commit -m "test: seed a labyrinth with a wall, a gate and a key"
```

---

## Task 5: Reading the run, and moving

**Files:**
- Create: `src/server/api/routers/run.ts`, `tests/integration/players.ts`, `tests/integration/run-router.test.ts`
- Modify: `src/server/api/root.ts`, `src/server/api/routers/AGENTS.md`, `messages/en.json`, `messages/sk.json`

**Interfaces:**
- Consumes: `participantRows`, `notYours`, `DbClient` from `~/server/match/access`; `situationFor`, `PlayerRow` from `~/server/match/situation`; `resolveCompletion`, `deadlineFor`, `isTerminal`, `RunFacts` from `~/match`; `advanceRun`, `freshRun`, `emptyMap`, `heldKeys`, `mazeSchema`, `DIRECTIONS` from `~/maze`; `GATED_MAZE_*` and `gatedMazeDraft` from the fixtures.
- Produces:
  - `run.get({ matchId }) → { status: MatchStatus; at: Point; map: DiscoveredMap; heldKeys: number[]; penalties: number; moves: number; nextSeq: number; finished: boolean; gaveUp: boolean }`
  - `run.move({ matchId, seq, dir }) → { delta: RunnerDelta; matchOver: boolean }`
  - `factsFor(p: PlayerRow): RunFacts`, exported from `run.ts` for Task 6
  - Error keys: `errors.runNotUnlocked`, `errors.runAlreadyFinished`, `errors.matchOver`, `errors.moveOutOfOrder`
  - `tests/integration/players.ts`: `signedIn()`, `runningMatch(): Promise<{ host, guest, hostId, guestId, matchId }>`, where `host` and `guest` are `ReturnType<typeof createCaller>`.

### How `move` is ordered

Inside one transaction:

1. Lock the match and both player rows (`participantRows(…, { lock: true })`).
2. **A `seq` already in the log returns its stored delta.** This comes before every other check, so a retried finishing move still gets its answer after the run, or the whole match, has ended.
3. Refuse on status (`matchOver` if terminal, `runNotUnlocked` before `running`), on the deadline having passed (`matchExpired`), and on a finished run (`runAlreadyFinished`).
4. Load the opponent's maze. Refuse a `seq` that is not `moves + 1` (`moveOutOfOrder`).
5. Apply the reducer; insert the move; update the player row; then either complete the match or recompute `deadlineAt`.

A second request with the same `seq` waits on the lock at step 1, then returns at step 2. That is why the unique constraint never fires in normal operation. It is the backstop, not the mechanism.

- [ ] **Step 1: Write the shared integration helpers**

`tests/integration/players.ts`:

```ts
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";

import {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  gatedMazeDraft,
} from "../fixtures/maze";

export async function signedIn() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

const settings = {
  cellCount: GATED_MAZE_CELL_COUNT,
  gateCount: GATED_MAZE_GATE_COUNT,
} as const;

async function submitGated(
  caller: ReturnType<typeof createCaller>,
  matchId: string,
) {
  const created = await caller.maze.createDraft({ name: "Gated", ...settings });
  await caller.maze.saveDraft({ id: created.id, data: gatedMazeDraft() });
  await caller.match.submitMaze({ matchId, mazeId: created.id });
}

/**
 * Two players in a `running` match, each solving the other's copy of the
 * gated seed — so `GATED_MAZE_ROUTE` solves the run for either of them.
 */
export async function runningMatch() {
  const hostCtx = await signedIn();
  const guestCtx = await signedIn();
  const host = createCaller(hostCtx);
  const guest = createCaller(guestCtx);

  const created = await host.match.create(settings);
  await guest.match.join({ code: created.code });
  await submitGated(host, created.id);
  await submitGated(guest, created.id);

  return {
    host,
    guest,
    hostId: hostCtx.session!.user.id,
    guestId: guestCtx.session!.user.id,
    matchId: created.id,
  };
}
```

- [ ] **Step 2: Write the failing router tests**

`tests/integration/run-router.test.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { HOURS_24_MS } from "~/match";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { match, matchPlayer, move } from "~/server/db/schema";

import { GATED_MAZE_ROUTE } from "../fixtures/maze";
import { runningMatch, signedIn } from "./players";
import { rejection } from "./support";

type Caller = ReturnType<typeof createCaller>;

async function walk(caller: Caller, matchId: string, dirs: readonly string[]) {
  const results = [];
  for (const [i, dir] of dirs.entries()) {
    results.push(
      await caller.run.move({
        matchId,
        seq: i + 1,
        dir: dir as "N" | "E" | "S" | "W",
      }),
    );
  }
  return results;
}

describe("run.get", () => {
  it("starts a runner on the origin, knowing only that", async () => {
    const { host, matchId } = await runningMatch();
    expect(await host.run.get({ matchId })).toEqual({
      status: "running",
      at: { x: 0, y: 0 },
      map: { cells: [{ x: 0, y: 0 }], segments: [] },
      heldKeys: [],
      penalties: 0,
      moves: 0,
      nextSeq: 1,
      finished: false,
      gaveUp: false,
    });
  });

  it("refuses someone who is not in the match", async () => {
    const { matchId } = await runningMatch();
    const stranger = createCaller(await signedIn());
    expect(await rejection(stranger.run.get({ matchId }))).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
  });
});

describe("run.move", () => {
  it("moves, writes the log, and keeps the cache in step", async () => {
    const { host, hostId, matchId } = await runningMatch();

    const [first] = await walk(host, matchId, ["S"]);

    expect(first).toEqual({
      delta: {
        outcome: "moved",
        from: { x: 0, y: 0 },
        at: { x: 0, y: 1 },
        penalties: 0,
        moves: 1,
        finished: false,
        revealedCell: { x: 0, y: 1 },
      },
      matchOver: false,
    });
    const rows = await db
      .select()
      .from(move)
      .where(and(eq(move.matchId, matchId), eq(move.runnerId, hostId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seq: 1, dir: "S", outcome: "moved" });
    const state = await host.run.get({ matchId });
    expect(state).toMatchObject({ at: { x: 0, y: 1 }, moves: 1, nextSeq: 2 });
  });

  it("charges a penalty for a wall, and reports what stopped you", async () => {
    const { host, matchId } = await runningMatch();
    const results = await walk(host, matchId, ["S", "S", "S"]);
    expect(results[2]!.delta).toMatchObject({
      outcome: "blocked_wall",
      penalties: 1,
      revealedSegment: { o: "H", x: 0, y: 2, kind: "wall" },
    });
    expect(await host.run.get({ matchId })).toMatchObject({
      heldKeys: [1],
      penalties: 1,
    });
  });

  it("stores a boundary bump as such, and sends the runner a wall", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const [result] = await walk(host, matchId, ["N"]);
    expect(result!.delta.outcome).toBe("blocked_wall");
    const [row] = await db
      .select()
      .from(move)
      .where(and(eq(move.matchId, matchId), eq(move.runnerId, hostId)));
    expect(row!.outcome).toBe("blocked_boundary");
    expect(row!.delta.outcome).toBe("blocked_wall");
  });

  it("sends a boundary bump and a wall bump that differ only in position", async () => {
    // Invariant 6, through the router: from (0,0), N is off the shape; from
    // (0,2), S is a wall. Strip the coordinates and nothing may differ.
    const { host, matchId } = await runningMatch();
    const results = await walk(host, matchId, ["N", "S", "S", "S"]);
    const strip = (d: (typeof results)[number]["delta"]) => ({
      outcome: d.outcome,
      kind: d.revealedSegment?.kind,
      keys: Object.keys(d).sort(),
      segmentKeys: Object.keys(d.revealedSegment ?? {}).sort(),
    });
    expect(strip(results[0]!.delta)).toEqual(strip(results[3]!.delta));
  });

  it("returns nothing but the delta, and maps only what was walked", async () => {
    const { host, matchId } = await runningMatch();
    // S, S (key), S (wall), E, E: stands on (0,0) (0,1) (0,2) (1,2) (2,2).
    const results = await walk(host, matchId, GATED_MAZE_ROUTE.slice(0, 5));
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(["delta", "matchOver"]);
    }
    const state = await host.run.get({ matchId });
    expect(state.map.cells.map((c) => `${c.x},${c.y}`).sort()).toEqual(
      ["0,0", "0,1", "0,2", "1,2", "2,2"].sort(),
    );
    expect(state.map.segments).toEqual([
      { o: "H", x: 0, y: 2, kind: "wall" },
    ]);
    // Not the treasure, and not the gate four columns east.
    const json = JSON.stringify(state);
    expect(json).not.toContain("treasure");
    expect(json).not.toContain('"gate"');
  });

  it("finishes the run, and only the run, on the treasure", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const results = await walk(host, matchId, GATED_MAZE_ROUTE);
    expect(results.at(-1)).toMatchObject({
      delta: { outcome: "moved_found_treasure", finished: true },
      matchOver: false,
    });
    const [player] = await db
      .select()
      .from(matchPlayer)
      .where(
        and(eq(matchPlayer.matchId, matchId), eq(matchPlayer.userId, hostId)),
      );
    expect(player!.finishedAt).not.toBeNull();
    expect(player!.startedAt).not.toBeNull();
    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row!.status).toBe("running");
    // §9.1 row 7: 24h from the finish.
    expect(row!.deadlineAt.getTime() - player!.finishedAt!.getTime()).toBe(
      HOURS_24_MS,
    );
  });

  it("completes the match when the second runner finishes", async () => {
    const { host, guest, hostId, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    // The guest bumps the north boundary first: one more penalty, so the
    // host wins on penalties regardless of timing.
    const results = await walk(guest, matchId, ["N", ...GATED_MAZE_ROUTE]);
    expect(results.at(-1)!.matchOver).toBe(true);
    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row).toMatchObject({
      status: "complete",
      endReason: "finished",
      winnerId: hostId,
    });
  });

  it("refuses a move once the runner has finished", async () => {
    const { host, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    expect(
      await rejection(
        host.run.move({ matchId, seq: GATED_MAZE_ROUTE.length + 1, dir: "N" }),
      ),
    ).toEqual({ code: "CONFLICT", message: "errors.runAlreadyFinished" });
  });

  it("returns the stored delta for a retried seq, and charges nothing", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const [first] = await walk(host, matchId, ["N"]);
    const again = await host.run.move({ matchId, seq: 1, dir: "N" });
    expect(again).toEqual(first);
    // A retry carrying a different direction still gets what seq 1 did.
    const different = await host.run.move({ matchId, seq: 1, dir: "S" });
    expect(different).toEqual(first);
    const rows = await db
      .select()
      .from(move)
      .where(and(eq(move.matchId, matchId), eq(move.runnerId, hostId)));
    expect(rows).toHaveLength(1);
    expect(await host.run.get({ matchId })).toMatchObject({ penalties: 1 });
  });

  it("replays the finishing move after the match completed", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    await walk(guest, matchId, GATED_MAZE_ROUTE);
    const replay = await host.run.move({
      matchId,
      seq: GATED_MAZE_ROUTE.length,
      dir: "S",
    });
    expect(replay).toMatchObject({
      delta: { outcome: "moved_found_treasure" },
      matchOver: true,
    });
  });

  it("two concurrent moves on one seq write one row", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const [a, b] = await Promise.all([
      host.run.move({ matchId, seq: 1, dir: "N" }),
      host.run.move({ matchId, seq: 1, dir: "N" }),
    ]);
    expect(a).toEqual(b);
    const rows = await db
      .select()
      .from(move)
      .where(and(eq(move.matchId, matchId), eq(move.runnerId, hostId)));
    expect(rows).toHaveLength(1);
    expect(await host.run.get({ matchId })).toMatchObject({ penalties: 1 });
  });

  it("rejects a seq that is not next", async () => {
    const { host, matchId } = await runningMatch();
    expect(
      await rejection(host.run.move({ matchId, seq: 2, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.moveOutOfOrder" });
    await walk(host, matchId, ["S"]);
    expect(
      await rejection(host.run.move({ matchId, seq: 3, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.moveOutOfOrder" });
  });

  it("refuses a move before the runs unlock", async () => {
    const ctx = await signedIn();
    const host = createCaller(ctx);
    const created = await host.match.create({ cellCount: 36, gateCount: 1 });
    expect(
      await rejection(host.run.move({ matchId: created.id, seq: 1, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.runNotUnlocked" });
  });

  it("refuses a move after the deadline, before the sweep has run", async () => {
    const { host, matchId } = await runningMatch();
    await db
      .update(match)
      .set({ deadlineAt: new Date(Date.now() - 1000) })
      .where(eq(match.id, matchId));
    expect(
      await rejection(host.run.move({ matchId, seq: 1, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchExpired" });
  });

  it("refuses a move on a match that is over", async () => {
    const { host, matchId } = await runningMatch();
    await db
      .update(match)
      .set({ status: "abandoned", endReason: "abandoned" })
      .where(eq(match.id, matchId));
    expect(
      await rejection(host.run.move({ matchId, seq: 1, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchOver" });
  });

  it("moves the deadline to row 6 on the first move, and row 5 once both move", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, ["S"]);
    let [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row!.deadlineAt.getTime() - row!.lastActivityAt.getTime()).toBe(
      HOURS_24_MS,
    );
    await walk(guest, matchId, ["S"]);
    [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row!.deadlineAt.getTime() - row!.lastActivityAt.getTime()).toBe(
      2 * HOURS_24_MS,
    );
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm test:integration tests/integration/run-router.test.ts`
Expected: FAIL, `host.run` is undefined.

- [ ] **Step 4: Write `src/server/api/routers/run.ts`**

```ts
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  deadlineFor,
  isTerminal,
  resolveCompletion,
  type RunFacts,
} from "~/match";
import {
  DIRECTIONS,
  advanceRun,
  emptyMap,
  freshRun,
  heldKeys,
  mazeSchema,
  type Maze,
} from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { match, matchPlayer, maze, move } from "~/server/db/schema";
import {
  notYours,
  participantRows,
  type DbClient,
} from "~/server/match/access";
import {
  situationFor,
  type MatchRow,
  type PlayerRow,
} from "~/server/match/situation";

function refuse(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

export function factsFor(p: PlayerRow): RunFacts {
  return {
    userId: p.userId,
    startedAt: p.startedAt,
    finishedAt: p.finishedAt,
    gaveUpAt: p.gaveUpAt,
    penalties: p.runState?.state.penalties ?? 0,
    moves: p.runState?.state.moves ?? 0,
  };
}

/** The refusals shared by everything that changes a run. */
export function assertRunOpen(row: MatchRow, now: Date) {
  if (isTerminal(row.status)) refuse("errors.matchOver");
  if (row.status !== "running") refuse("errors.runNotUnlocked");
  // The sweep runs every 15 minutes; between a deadline passing and the
  // sweep closing the match, nothing may change it.
  if (now.getTime() >= row.deadlineAt.getTime()) refuse("errors.matchExpired");
}

/**
 * The maze this runner is solving: the opponent's. **This reads
 * `maze.data` on a runner-reachable path** — the one sanctioned place
 * besides `run.result` (see `routers/AGENTS.md`). What it returns must never
 * leave the server; `run.move` hands it only to the reducer.
 */
async function mazeToSolve(tx: DbClient, opponent: PlayerRow): Promise<Maze> {
  const [row] = await tx
    .select({ data: maze.data })
    .from(maze)
    .where(eq(maze.id, opponent.mazeId!));
  return mazeSchema.parse(row!.data);
}

export const runRouter = createTRPCRouter({
  /**
   * The runner's own view. Reads `runState.view` and never touches
   * `maze.data`: everything here was already sent to this runner as a delta.
   */
  get: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await participantRows(
        ctx.db,
        input.matchId,
        ctx.session.user.id,
      );
      if (!found) notYours();

      const you = found.players.find((p) => p.userId === ctx.session.user.id)!;
      const view = you.runState?.view ?? { at: { x: 0, y: 0 }, map: emptyMap() };
      const moves = you.runState?.state.moves ?? 0;

      return {
        status: found.row.status,
        at: view.at,
        map: view.map,
        heldKeys: heldKeys(view.map),
        penalties: you.runState?.state.penalties ?? 0,
        moves,
        nextSeq: moves + 1,
        finished: you.finishedAt !== null,
        gaveUp: you.gaveUpAt !== null,
      };
    }),

  move: protectedProcedure
    .input(
      z.object({
        matchId: z.string(),
        seq: z.number().int().min(1),
        dir: z.enum(DIRECTIONS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const me = ctx.session.user.id;

      return ctx.db.transaction(async (tx) => {
        const found = await participantRows(tx, input.matchId, me, {
          lock: true,
        });
        if (!found) notYours();
        const { row, players } = found;

        // §7.2, and before every other check: a retry gets what the first
        // attempt got, even if that attempt finished the run or the match.
        const [stored] = await tx
          .select({ delta: move.delta })
          .from(move)
          .where(
            and(
              eq(move.matchId, row.id),
              eq(move.runnerId, me),
              eq(move.seq, input.seq),
            ),
          );
        if (stored) {
          return { delta: stored.delta, matchOver: isTerminal(row.status) };
        }

        assertRunOpen(row, now);
        const you = players.find((p) => p.userId === me)!;
        const them = players.find((p) => p.userId !== me)!;
        if (you.finishedAt !== null) refuse("errors.runAlreadyFinished");

        const solving = await mazeToSolve(tx, them);
        const current = you.runState ?? freshRun(solving);
        if (input.seq !== current.state.moves + 1) {
          refuse("errors.moveOutOfOrder");
        }

        const { run, delta, outcome } = advanceRun(current, solving, input.dir);

        await tx.insert(move).values({
          matchId: row.id,
          runnerId: me,
          seq: input.seq,
          dir: input.dir,
          outcome,
          delta,
          createdAt: now,
        });

        const updated: PlayerRow = {
          ...you,
          runState: run,
          startedAt: you.startedAt ?? now,
          lastMoveAt: now,
          finishedAt: delta.finished ? now : null,
        };
        await tx
          .update(matchPlayer)
          .set({
            runState: updated.runState,
            startedAt: updated.startedAt,
            lastMoveAt: updated.lastMoveAt,
            finishedAt: updated.finishedAt,
          })
          .where(
            and(eq(matchPlayer.matchId, row.id), eq(matchPlayer.userId, me)),
          );

        const seated = players.map((p) => (p.userId === me ? updated : p));
        const completion = resolveCompletion(seated.map(factsFor));

        if (completion.kind === "complete") {
          await tx
            .update(match)
            .set({
              status: "complete",
              winnerId: completion.winnerId,
              endReason: completion.endReason,
              lastActivityAt: now,
            })
            .where(eq(match.id, row.id));
        } else {
          const next = { ...row, lastActivityAt: now };
          await tx
            .update(match)
            .set({
              lastActivityAt: now,
              deadlineAt: deadlineFor(situationFor(next, seated))!,
            })
            .where(eq(match.id, row.id));
        }

        return { delta, matchOver: completion.kind === "complete" };
      });
    }),
});
```

Mount it in `src/server/api/root.ts` as `run: runRouter`, between `match` and `testSupport`.

- [ ] **Step 5: Record the sanctioned readers in `src/server/api/routers/AGENTS.md`**

Append:

```markdown
## The two sanctioned readers

`run.move` reads the opponent's `maze.data` to apply the reducer, and returns
only a `RunnerDelta`. `run.result` returns both mazes, and only for a terminal
match in which both players submitted. Those are the only two. A new procedure
that needs the maze is a design conversation, not an implementation detail.

`run.get` is the runner's read and must stay free of `maze.data`: everything it
returns comes from `runState.view`, which is built only from deltas the runner
was already sent.
```

- [ ] **Step 6: Add the error copy**

To `errors` in `messages/en.json`:

```json
"runNotUnlocked": "The runs have not unlocked yet.",
"runAlreadyFinished": "Your run is already over.",
"matchOver": "This match is over.",
"moveOutOfOrder": "That move arrived out of order. Your view has been refreshed."
```

To `errors` in `messages/sk.json`:

```json
"runNotUnlocked": "Behy ešte nie sú odomknuté.",
"runAlreadyFinished": "Váš beh sa už skončil.",
"matchOver": "Tento zápas sa skončil.",
"moveOutOfOrder": "Ťah prišiel mimo poradia. Váš pohľad bol obnovený."
```

- [ ] **Step 7: Run the tests**

Run: `pnpm test:integration tests/integration/run-router.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 8: Break it and watch it fail**

1. Move the stored-`seq` lookup below `assertRunOpen`. "replays the finishing move after the match completed" must fail with `errors.matchOver`.
2. Pass `{ lock: false }` in `move`. Run "two concurrent moves on one seq write one row" five times (`pnpm test:integration -t "concurrent" --repeat 5`). Expect at least one failure on `move_runner_seq_unique`. That is the backstop catching what the lock should have prevented, and the reason the lock exists.

Restore both.

- [ ] **Step 9: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add src/server tests/integration messages
git commit -m "feat: move through the opponent's labyrinth"
```

---

## Task 6: Giving up, the result, and the sweep's new rows

**Files:**
- Modify: `src/server/api/routers/run.ts`, `messages/en.json`, `messages/sk.json`, `tests/integration/sweep.test.ts`
- Create: `tests/integration/run-result.test.ts`

**Interfaces:**
- Consumes: `factsFor`, `assertRunOpen` (Task 5); `elapsedMs`, `decidingField`, `isTerminal` from `~/match`; `pathFrom`, `mazeSchema`, `Maze`, `Point` from `~/maze`; `user` table.
- Produces:
  - `run.giveUp({ matchId }) → { status: "complete" }`
  - `run.result({ matchId }) →`
    ```ts
    {
      status: "complete" | "abandoned";
      outcome: "won" | "lost" | "none";
      reason: "treasure" | "tie" | "gaveUp" | "timeout" | "abandoned";
      gaveUpBy: "you" | "opponent" | null;
      decidedBy: "penalties" | "moves" | "time" | null;
      you: ResultScore;
      opponent: ResultScore | null;
      mazes: { theirs: { maze: Maze; path: Point[] }; yours: { maze: Maze; path: Point[] } } | null;
    }
    // ResultScore = { displayName: string; penalties: number; moves: number;
    //                 elapsedMs: number | null; finished: boolean; gaveUp: boolean;
    //                 timedOut: boolean }
    ```
    `path` is in **absolute maze coordinates**, so the client can draw it straight onto `maze`.
  - Error key `errors.resultNotReady`.

**Reason, decided once on the server:**

| Match | `reason` |
|---|---|
| `abandoned` | `abandoned` |
| someone has `gaveUpAt` | `gaveUp` |
| `endReason: finished`, winner null | `tie` |
| `endReason: finished` | `treasure` |
| `endReason: forfeit`, nobody gave up | `timeout`: the loser ran out of time after the winner finished |

- [ ] **Step 1: Write the failing tests**

`tests/integration/run-result.test.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";

import { GATED_MAZE_ROUTE, gatedMazeDraft } from "../fixtures/maze";
import { runningMatch, signedIn } from "./players";
import { rejection } from "./support";

type Caller = ReturnType<typeof createCaller>;

async function walk(caller: Caller, matchId: string, dirs: readonly string[]) {
  for (const [i, dir] of dirs.entries()) {
    await caller.run.move({
      matchId,
      seq: i + 1,
      dir: dir as "N" | "E" | "S" | "W",
    });
  }
}

describe("run.giveUp", () => {
  it("ends the match at once and gives the opponent the win", async () => {
    const { host, guestId, matchId } = await runningMatch();
    await walk(host, matchId, ["S"]);

    expect(await host.run.giveUp({ matchId })).toEqual({ status: "complete" });

    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row).toMatchObject({
      status: "complete",
      endReason: "forfeit",
      winnerId: guestId,
    });
  });

  it("gives the win even to an opponent who never moved", async () => {
    const { guest, hostId, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row!.winnerId).toBe(hostId);
  });

  it("stops the opponent's run", async () => {
    const { host, guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    expect(
      await rejection(host.run.move({ matchId, seq: 1, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchOver" });
  });

  it("refuses a runner who already found the treasure", async () => {
    const { host, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    expect(await rejection(host.run.giveUp({ matchId }))).toEqual({
      code: "CONFLICT",
      message: "errors.runAlreadyFinished",
    });
  });

  it("refuses after the deadline, so expiry cannot be turned into a win", async () => {
    const { host, matchId } = await runningMatch();
    await db
      .update(match)
      .set({ deadlineAt: new Date(Date.now() - 1000) })
      .where(eq(match.id, matchId));
    expect(await rejection(host.run.giveUp({ matchId }))).toEqual({
      code: "CONFLICT",
      message: "errors.matchExpired",
    });
  });

  it("refuses a match that is over", async () => {
    const { host, guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    expect(await rejection(host.run.giveUp({ matchId }))).toEqual({
      code: "CONFLICT",
      message: "errors.matchOver",
    });
  });
});

describe("run.result", () => {
  it("is refused while the match is running", async () => {
    const { host, matchId } = await runningMatch();
    expect(await rejection(host.run.result({ matchId }))).toEqual({
      code: "CONFLICT",
      message: "errors.resultNotReady",
    });
  });

  it("is refused to someone not in the match", async () => {
    const { guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    const stranger = createCaller(await signedIn());
    expect(await rejection(stranger.run.result({ matchId }))).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
  });

  it("reports a finished match from each side, with both paths", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    await walk(guest, matchId, ["N", ...GATED_MAZE_ROUTE]);

    const forHost = await host.run.result({ matchId });
    expect(forHost).toMatchObject({
      status: "complete",
      outcome: "won",
      reason: "treasure",
      gaveUpBy: null,
      decidedBy: "penalties",
      you: { penalties: 1, moves: 11, finished: true, gaveUp: false },
      opponent: { penalties: 2, moves: 12, finished: true },
    });
    expect(forHost.you.elapsedMs).not.toBeNull();

    // The gated seed starts at (0,0), so absolute and relative coincide; the
    // route visits 11 cells (10 moved moves plus the start). The bump adds
    // no point.
    const draft = gatedMazeDraft();
    expect(forHost.mazes!.theirs.maze.cells).toHaveLength(draft.cells.length);
    expect(forHost.mazes!.theirs.path).toHaveLength(11);
    expect(forHost.mazes!.theirs.path.at(-1)).toEqual({ x: 5, y: 5 });
    expect(forHost.mazes!.yours.path).toHaveLength(11);

    const forGuest = await guest.run.result({ matchId });
    expect(forGuest).toMatchObject({ outcome: "lost", reason: "treasure" });
    expect(forGuest.mazes!.theirs.path).toEqual(forHost.mazes!.yours.path);
  });

  it("names who gave up", async () => {
    const { host, guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    expect(await host.run.result({ matchId })).toMatchObject({
      outcome: "won",
      reason: "gaveUp",
      gaveUpBy: "opponent",
      decidedBy: null,
    });
    expect(await guest.run.result({ matchId })).toMatchObject({
      outcome: "lost",
      reason: "gaveUp",
      gaveUpBy: "you",
    });
  });

  it("reveals no maze for a match that never reached running", async () => {
    // Review Focus 3: the host drew and submitted; the guest never did. The
    // guest has not "faced" the host's maze (mazesFacedBy), so the host may
    // still reuse it against them — revealing it here would spoil that.
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const guest = createCaller(await signedIn());
    const created = await host.match.create({ cellCount: 36, gateCount: 1 });
    await guest.match.join({ code: created.code });
    const draft = await host.maze.createDraft({
      name: "Mine",
      cellCount: 36,
      gateCount: 1,
    });
    await host.maze.saveDraft({ id: draft.id, data: gatedMazeDraft() });
    await host.match.submitMaze({ matchId: created.id, mazeId: draft.id });
    await db
      .update(match)
      .set({ status: "abandoned", endReason: "abandoned" })
      .where(eq(match.id, created.id));

    const result = await guest.run.result({ matchId: created.id });
    expect(result).toMatchObject({
      status: "abandoned",
      outcome: "none",
      reason: "abandoned",
      mazes: null,
    });
  });

  it("calls a forfeit after a finish a timeout", async () => {
    const { host, guest, hostId, guestId, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    // What the sweep writes for §9.1 row 7.
    await db
      .update(match)
      .set({ status: "complete", endReason: "forfeit", winnerId: hostId })
      .where(eq(match.id, matchId));
    await db
      .update(matchPlayer)
      .set({ forfeitedAt: new Date() })
      .where(
        and(eq(matchPlayer.matchId, matchId), eq(matchPlayer.userId, guestId)),
      );
    expect(await guest.run.result({ matchId })).toMatchObject({
      outcome: "lost",
      reason: "timeout",
      you: { timedOut: true },
    });
  });
});
```

Append to `tests/integration/sweep.test.ts`, inside its existing `describe`. Use that file's own helpers, adding `move` and `runningMatch` imports as needed:

```ts
  it("gives the finisher the win once the other runner's 24h is up", async () => {
    const { host, hostId, guestId, matchId } = await runningMatch();
    for (const [i, dir] of GATED_MAZE_ROUTE.entries()) {
      await host.run.move({ matchId, seq: i + 1, dir });
    }
    const [row] = await db.select().from(match).where(eq(match.id, matchId));

    await sweepExpiredMatches(db, new Date(row!.deadlineAt.getTime() + 1));

    const [after] = await db.select().from(match).where(eq(match.id, matchId));
    expect(after).toMatchObject({
      status: "complete",
      endReason: "forfeit",
      winnerId: hostId,
    });
    const [guestRow] = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.userId, guestId));
    expect(guestRow!.forfeitedAt).not.toBeNull();
  });

  it("abandons a one-mover match on row 6, blaming the one who never moved", async () => {
    const { host, guestId, hostId, matchId } = await runningMatch();
    await host.run.move({ matchId, seq: 1, dir: "S" });
    const [row] = await db.select().from(match).where(eq(match.id, matchId));

    await sweepExpiredMatches(db, new Date(row!.deadlineAt.getTime() + 1));

    const [after] = await db.select().from(match).where(eq(match.id, matchId));
    expect(after).toMatchObject({ status: "abandoned", winnerId: null });
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, matchId));
    expect(players.find((p) => p.userId === guestId)!.forfeitedAt).not.toBeNull();
    expect(players.find((p) => p.userId === hostId)!.forfeitedAt).toBeNull();
  });
```

with imports `import { GATED_MAZE_ROUTE } from "../fixtures/maze";` and `import { runningMatch } from "./players";`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:integration tests/integration/run-result.test.ts tests/integration/sweep.test.ts`
Expected: FAIL. `run.giveUp` and `run.result` do not exist. The two sweep tests should **pass already**: Task 3 wired `situationFor` and Task 2 fixed row 6. If either fails, Task 2 or 3 is incomplete, and that is the finding.

- [ ] **Step 3: Add `giveUp` and `result` to `runRouter`**

Add to the imports: `asc`, `inArray` from `drizzle-orm`; `decidingField`, `elapsedMs` from `~/match`; `pathFrom`, `type Point` from `~/maze`; `user` from the schema. Then:

```ts
  /** Spec §9.2. Confirmed in the client; irreversible here. */
  giveUp: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const me = ctx.session.user.id;

      return ctx.db.transaction(async (tx) => {
        const found = await participantRows(tx, input.matchId, me, {
          lock: true,
        });
        if (!found) notYours();
        const { row, players } = found;

        assertRunOpen(row, now);
        const you = players.find((p) => p.userId === me)!;
        if (you.finishedAt !== null) refuse("errors.runAlreadyFinished");

        await tx
          .update(matchPlayer)
          .set({ gaveUpAt: now })
          .where(
            and(eq(matchPlayer.matchId, row.id), eq(matchPlayer.userId, me)),
          );

        const seated = players.map((p) =>
          p.userId === me ? { ...p, gaveUpAt: now } : p,
        );
        const completion = resolveCompletion(seated.map(factsFor));
        // A give-up completes the match by definition; `resolveCompletion`
        // returning anything else would be a bug in it, not a state to
        // handle.
        if (completion.kind !== "complete") {
          throw new Error("a give-up must complete the match");
        }

        await tx
          .update(match)
          .set({
            status: "complete",
            winnerId: completion.winnerId,
            endReason: completion.endReason,
            lastActivityAt: now,
          })
          .where(eq(match.id, row.id));

        return { status: "complete" as const };
      });
    }),

  /**
   * Spec §10.3.1. Returns both mazes — the second sanctioned reader of
   * `maze.data` (see `routers/AGENTS.md`) — and only once the match is over
   * **and** both players submitted. A match abandoned during `drawing` never
   * exposed either maze to the other player, and `mazesFacedBy` agrees: it
   * counts a maze as faced only once the opponent submitted too. Revealing
   * one here would show a maze its author may still reuse against this
   * opponent.
   */
  result: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      const found = await participantRows(ctx.db, input.matchId, me);
      if (!found) notYours();
      const { row, players } = found;
      if (row.status !== "complete" && row.status !== "abandoned") {
        refuse("errors.resultNotReady");
      }

      const you = players.find((p) => p.userId === me)!;
      const them = players.find((p) => p.userId !== me) ?? null;

      const names = await ctx.db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, players.map((p) => p.userId)));
      const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? "";

      const score = (p: PlayerRow) => ({
        displayName: nameOf(p.userId),
        penalties: p.runState?.state.penalties ?? 0,
        moves: p.runState?.state.moves ?? 0,
        elapsedMs: elapsedMs(factsFor(p)),
        finished: p.finishedAt !== null,
        gaveUp: p.gaveUpAt !== null,
        timedOut: p.forfeitedAt !== null,
      });

      const quitter = players.find((p) => p.gaveUpAt !== null) ?? null;
      const reason =
        row.status === "abandoned"
          ? ("abandoned" as const)
          : quitter
            ? ("gaveUp" as const)
            : row.endReason === "finished"
              ? row.winnerId === null
                ? ("tie" as const)
                : ("treasure" as const)
              : ("timeout" as const);

      let mazes: {
        theirs: { maze: Maze; path: Point[] };
        yours: { maze: Maze; path: Point[] };
      } | null = null;

      if (them && you.submittedAt !== null && them.submittedAt !== null) {
        const mazeRows = await ctx.db
          .select({ id: maze.id, data: maze.data })
          .from(maze)
          .where(inArray(maze.id, [you.mazeId!, them.mazeId!]));
        const log = await ctx.db
          .select({ runnerId: move.runnerId, delta: move.delta })
          .from(move)
          .where(eq(move.matchId, row.id))
          .orderBy(asc(move.seq));

        const load = (id: string) =>
          mazeSchema.parse(mazeRows.find((m) => m.id === id)!.data);
        // Deltas are start-relative (see RunnerDelta); the result draws on
        // the full maze, so translate back by its start cell.
        const pathOn = (m: Maze, runnerId: string) =>
          pathFrom(
            log.filter((l) => l.runnerId === runnerId).map((l) => l.delta),
          ).map((p) => ({ x: p.x + m.start.x, y: p.y + m.start.y }));

        const theirMaze = load(them.mazeId!);
        const yourMaze = load(you.mazeId!);
        mazes = {
          theirs: { maze: theirMaze, path: pathOn(theirMaze, me) },
          yours: { maze: yourMaze, path: pathOn(yourMaze, them.userId) },
        };
      }

      return {
        status: row.status,
        outcome:
          row.winnerId === null
            ? ("none" as const)
            : row.winnerId === me
              ? ("won" as const)
              : ("lost" as const),
        reason,
        gaveUpBy: quitter
          ? quitter.userId === me
            ? ("you" as const)
            : ("opponent" as const)
          : null,
        decidedBy:
          reason === "treasure" && them
            ? decidingField(factsFor(you), factsFor(them))
            : null,
        you: score(you),
        opponent: them ? score(them) : null,
        mazes,
      };
    }),
```

- [ ] **Step 4: Add the error copy**

`messages/en.json` → `errors.resultNotReady`: `"The result is not ready yet."`
`messages/sk.json` → `errors.resultNotReady`: `"Výsledok ešte nie je k dispozícii."`

- [ ] **Step 5: Run the tests**

Run: `pnpm test:integration`
Expected: PASS. `run-result.test.ts` has 12 tests, and `sweep.test.ts` gains 2.

- [ ] **Step 6: Break it and watch it fail**

Change the reveal condition to `if (them)`. "reveals no maze for a match that never reached running" must fail. Delete `assertRunOpen` from `giveUp`. "refuses after the deadline" and "refuses a match that is over" must both fail. Restore both.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add src/server tests/integration messages
git commit -m "feat: give up, and reveal the result once the match is over"
```

---

## A note on Tasks 7 and 8

As in Phase 3, the UI tasks ship no tests of their own. There is no jsdom (AGENTS.md "Testing"), and Task 9's end-to-end specs drive every screen these tasks build. Their verification is `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test` (catalogue parity) and careful reading. The one pure helper (`formatElapsed`) gets a unit test, because it is pure.

House patterns, all enforced by review:

- **Errors render through `resolveErrorKey`**, never `error.message`.
- **Irreversible actions get a confirmation step and a pending state.** Giving up is irreversible.
- **Colours come from the tokens** in `src/styles/globals.css`, and gate colours from `gateColour`. No raw `oklch()` in a component.
- **Every string in both catalogues**, idiomatic Slovak, ICU `plural` for counts with `one`/`few`/`other` in Slovak.
- **Every DOM hook Task 9 selects on is listed in the task's Produces block.** Do not rename one without updating both.
- **The run board must never render anything about a square the runner has not discovered**: no grid of unknown cells, no void/painted labels, nothing in the accessibility tree. `src/components/editor/board.tsx:54` explains why the editor board cannot be reused.

---

## Task 7: The run view

**Files:**
- Create: `src/components/run/run-board.tsx`, `src/components/run/use-move-queue.ts`, `src/components/run/run-view.tsx`, `src/components/match/match-screen.tsx`
- Modify: `src/app/[locale]/(app)/matches/[id]/page.tsx`, `src/components/match/match-lobby.tsx`, `src/styles/globals.css`, `messages/en.json`, `messages/sk.json`

**Interfaces:**
- Consumes: `run.get`, `run.move`, `run.giveUp`, `match.get`; `recordDelta`, `heldKeys`, `edgeKey`, `cellKey`, `type DiscoveredMap`, `type RunnerDelta`, `type Direction`, `type Point`, `type RevealedSegment` from `~/maze`; `CELL_PX` from `~/components/editor/board`; `gateColour` from `~/components/editor/gate-colours`; `isTerminal` from `~/match`.
- Produces:
  - `<MatchScreen matchId initialData />`, which replaces `<MatchLobby>` on the page
  - `<RunView matchId opponentName />`, `<RunBoard map at bump pending heldKeys />`, `useMoveQueue(...)`
  - DOM hooks: `[data-run-view]`; `[data-penalties="N"]`; `[data-moves="N"]`; `[data-held-key="G"]` (one per held key); `[data-run-pending]` (present while a move is in flight); `[data-run-finished]` (the waiting state); `[data-run-board]`; `[data-runner-at="x,y"]` (start-relative); `[data-run-segment="H:x,y"]` (via `edgeKey`, start-relative); `[data-run-announcement]` (the live region); d-pad buttons named by `run.moveN`/`E`/`S`/`W`; the give-up button named `run.giveUp` and its confirmation named `run.giveUpYes`.

- [ ] **Step 1: Add the copy**

`messages/en.json`: add a top-level `run` namespace:

```json
"run": {
  "boardLabel": "Your view of the labyrinth",
  "hint": "Arrow keys or WASD to move. Every bump costs a penalty.",
  "penaltiesLabel": "Penalties",
  "movesLabel": "Moves",
  "keysLabel": "Keys",
  "noKeys": "None yet",
  "keyName": "Key {gate}",
  "dpadLabel": "Move",
  "moveN": "Move north",
  "moveE": "Move east",
  "moveS": "Move south",
  "moveW": "Move west",
  "announceMoved": "Moved.",
  "announceWall": "Blocked by a wall. {penalties, plural, one {# penalty} other {# penalties}} so far.",
  "announceGate": "Gate {gate} is closed. You need its key. {penalties, plural, one {# penalty} other {# penalties}} so far.",
  "announceKey": "You found key {gate}.",
  "announceThroughGate": "You opened gate {gate}.",
  "announceTreasure": "You found the treasure!",
  "finishedWaiting": "You found the treasure with {penalties, plural, one {# penalty} other {# penalties}} in {moves, plural, one {# move} other {# moves}}. The result is revealed once your opponent finishes or runs out of time.",
  "giveUp": "Give up",
  "confirmGiveUp": "Give up? {name} wins immediately, and this cannot be undone.",
  "giveUpYes": "Yes, give up",
  "giveUpNo": "Keep going",
  "givingUp": "Giving up…"
}
```

`messages/sk.json`:

```json
"run": {
  "boardLabel": "Váš pohľad na bludisko",
  "hint": "Pohybujte sa šípkami alebo klávesmi WASD. Každý náraz stojí penalizáciu.",
  "penaltiesLabel": "Penalizácie",
  "movesLabel": "Ťahy",
  "keysLabel": "Kľúče",
  "noKeys": "Zatiaľ žiadne",
  "keyName": "Kľúč {gate}",
  "dpadLabel": "Pohyb",
  "moveN": "Pohyb na sever",
  "moveE": "Pohyb na východ",
  "moveS": "Pohyb na juh",
  "moveW": "Pohyb na západ",
  "announceMoved": "Posun.",
  "announceWall": "Narazili ste do steny. Zatiaľ {penalties, plural, one {# penalizácia} few {# penalizácie} other {# penalizácií}}.",
  "announceGate": "Brána {gate} je zatvorená, potrebujete jej kľúč. Zatiaľ {penalties, plural, one {# penalizácia} few {# penalizácie} other {# penalizácií}}.",
  "announceKey": "Našli ste kľúč {gate}.",
  "announceThroughGate": "Otvorili ste bránu {gate}.",
  "announceTreasure": "Našli ste poklad!",
  "finishedWaiting": "Našli ste poklad s {penalties, plural, one {# penalizáciou} few {# penalizáciami} other {# penalizáciami}} za {moves, plural, one {# ťah} few {# ťahy} other {# ťahov}}. Výsledok uvidíte, keď súper dobehne do cieľa alebo mu vyprší čas.",
  "giveUp": "Vzdať sa",
  "confirmGiveUp": "Vzdať sa? {name} okamžite vyhráva a nedá sa to vrátiť späť.",
  "giveUpYes": "Áno, vzdať sa",
  "giveUpNo": "Pokračovať",
  "givingUp": "Vzdávate sa…"
}
```

Delete `lobby.bothIn` and `lobby.runsComingSoon` from both catalogues. The lobby no longer renders a running match (Step 6).

- [ ] **Step 2: Add the shake animation to `src/styles/globals.css`**

Inside the existing top `@theme { … }` block:

```css
  --animate-shake: shake 240ms ease-in-out;

  @keyframes shake {
    0%,
    100% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(-4px);
    }
    75% {
      transform: translateX(4px);
    }
  }
```

Components use it only as `motion-safe:animate-shake`, so reduced-motion users see the drawn segment without the movement.

- [ ] **Step 3: Write `src/components/run/use-move-queue.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Direction, RunnerDelta } from "~/maze";
import { api } from "~/trpc/react";

/**
 * One move waiting behind the one in flight. Key auto-repeat fires every
 * ~30ms, far faster than a ~150ms round trip; a deeper queue would keep the
 * runner walking for a second after the key was released (spec §7.3).
 */
const MAX_WAITING = 1;

type Handlers = {
  onDelta: (delta: RunnerDelta) => void;
  /** The match ended under us: the opponent gave up, or the deadline passed. */
  onMatchOver: () => void;
  /** Anything else went wrong. Trust the server: refetch and start again. */
  onResync: () => void;
};

/**
 * Sends moves one at a time, each with the next `seq` (spec §7.2), and never
 * draws a move before the server answers (§7.3). `nextSeq` comes from
 * `run.get`, so a resync — a second tab, a dropped connection — re-seeds the
 * counter from the server rather than from whatever this tab believed.
 */
export function useMoveQueue(
  matchId: string,
  nextSeq: number,
  handlers: Handlers,
) {
  const move = api.run.move.useMutation();
  const queue = useRef<Direction[]>([]);
  const busy = useRef(false);
  const seq = useRef(nextSeq);
  const latest = useRef(handlers);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!busy.current) seq.current = nextSeq;
  }, [nextSeq]);

  const pump = useCallback(async () => {
    if (busy.current) return;
    const dir = queue.current.shift();
    if (!dir) return;

    busy.current = true;
    setPending(true);
    try {
      const result = await move.mutateAsync({ matchId, seq: seq.current, dir });
      seq.current += 1;
      latest.current.onDelta(result.delta);
      if (result.delta.finished || result.matchOver) queue.current = [];
      if (result.matchOver) latest.current.onMatchOver();
    } catch (error) {
      queue.current = [];
      const message = (error as { message?: string }).message;
      if (message === "errors.matchOver" || message === "errors.matchExpired") {
        latest.current.onMatchOver();
      } else {
        latest.current.onResync();
      }
    } finally {
      busy.current = false;
      setPending(false);
      void pump();
    }
  }, [matchId, move]);

  const enqueue = useCallback(
    (dir: Direction) => {
      if (queue.current.length >= MAX_WAITING) return;
      queue.current.push(dir);
      void pump();
    },
    [pump],
  );

  return { enqueue, pending };
}
```

- [ ] **Step 4: Write `src/components/run/run-board.tsx`**

A client component. Props: `{ map: DiscoveredMap; at: Point; heldKeys: readonly number[]; bump: { segment: RevealedSegment; id: number } | null; pending: boolean }`.

- **Viewport.** Take the bounding box of every cell in `map.cells`, every cell either side of every segment in `map.segments`, and `at`, then pad one cell on each side. Use it as the SVG `viewBox` in pixels (`CELL_PX` per cell). Negative coordinates are ordinary, since everything is start-relative. Cap the rendered width with `max-w-[700px] w-full h-auto` like the editor, so a small explored area draws large and a large one shrinks to fit.
- **Fog.** One background `<rect>` covering the whole viewBox in `fill-cell-void`. Then one `<rect data-run-cell="x,y">` per discovered cell in `fill-cell-painted stroke-grid-line`. Nothing is drawn for an undiscovered square. There is no grid of unknowns and no per-cell label.
- **Contents.** A start ring (`stroke-accent`, no fill) at `(0,0)`. The treasure (`fill-danger`) on a cell with `treasure`. A small key circle in `gateColour(gate)` on a cell with `key`.
- **Segments.** One `<line data-run-segment={edgeKey(s)}>` per segment, using the editor's H/V line geometry (`board.tsx`, the segments block). Walls use `stroke-wall`. Gates use `gateColour`, drawn dashed (`strokeDasharray="6 4"`) when `heldKeys` includes the gate, so an opened gate reads as passable.
- **Runner.** A `<circle data-runner-at={`${at.x},${at.y}`}>` in `fill-accent`, at `opacity-60` while `pending`.
- **Bump.** When `bump` is non-null, wrap the board in a `<g key={bump.id} className="motion-safe:animate-shake">` (re-keying restarts the animation), and draw `bump.segment` thicker (`strokeWidth={6}`) on top.
- **Accessibility.** `<svg role="img" aria-label={t("boardLabel")} data-run-board>`, with every child `aria-hidden="true"`. What happened is announced by the view's live region, not by the board.

- [ ] **Step 5: Write `src/components/run/run-view.tsx`**

A client component. Props: `{ matchId: string; opponentName: string }`.

- **State.** `api.run.get.useQuery({ matchId })`. Render `null` while pending. The cache *is* the state: on each delta, write the new snapshot into it with `utils.run.get.setData({ matchId }, …)` using `recordDelta` and `heldKeys`. A resync is then just `utils.run.get.invalidate({ matchId })`:

```ts
const onDelta = (delta: RunnerDelta) => {
  utils.run.get.setData({ matchId }, (old) => {
    if (!old) return old;
    const map = recordDelta(old.map, delta);
    return {
      ...old,
      at: delta.at,
      map,
      heldKeys: heldKeys(map),
      penalties: delta.penalties,
      moves: delta.moves,
      nextSeq: delta.moves + 1,
      finished: delta.finished,
    };
  });
  setAnnouncement(announce(delta)); // see below
  if (delta.outcome.startsWith("blocked") && delta.revealedSegment) {
    setBump({ segment: delta.revealedSegment, id: delta.moves });
  }
};
```

- **The queue.** `useMoveQueue(matchId, data.nextSeq, { onDelta, onMatchOver, onResync })`. `onMatchOver` invalidates `match.get` for this match, so `MatchScreen` re-renders into the result. `onResync` invalidates `run.get` and sets the announcement to `errors.moveOutOfOrder` through `resolveErrorKey`.
- **Keyboard.** A `useEffect` adds a `keydown` listener on `window` while the run is open and not finished. Map `ArrowUp`/`w`/`W` → N, `ArrowRight`/`d`/`D` → E, `ArrowDown`/`s`/`S` → S, `ArrowLeft`/`a`/`A` → W. Ignore the event when any modifier is held, when `event.target` is an `input`, `textarea`, `select` or content-editable element, or while the give-up confirmation is open. Call `event.preventDefault()` on a mapped key so arrows do not scroll the page, then `enqueue(dir)`.
- **D-pad.** Four buttons in a `role="group" aria-label={t("dpadLabel")}` cross layout, each `aria-label`led by `run.moveN`/`E`/`S`/`W` and calling `enqueue`. Shown at every width: it is the only input on touch and harmless elsewhere. Minimum 44×44px.
- **HUD.** Penalties first and largest (`text-4xl font-bold`, `data-penalties={n}`), with `run.penaltiesLabel`. Then moves (`data-moves={n}`) and held keys: one swatch per key in `gateColour` with `run.keyName`, each `data-held-key={gate}`, or `run.noKeys`. While a move is in flight render `<span data-run-pending hidden />`.
- **Announcements.** `<p aria-live="polite" data-run-announcement className="sr-only">`. Map the outcome to copy: `moved` → `announceMoved`; `blocked_wall` → `announceWall`; `blocked_gate` → `announceGate` with `revealedSegment.gate`; `moved_found_key` → `announceKey` with `revealedCell.key`; `moved_through_gate` → `announceThroughGate`; `moved_found_treasure` → `announceTreasure`. Use a `satisfies Record<RunnerOutcome, …>` map so a new outcome fails to compile instead of announcing nothing.
- **Finished.** When `data.finished`, replace the d-pad and give-up controls with `<p data-run-finished>{t("finishedWaiting", { penalties, moves })}</p>`. Keep the board visible. The opponent's score is not shown, because it is not known (§9).
- **Give up.** A secondary button `run.giveUp`, hidden once finished. It opens an inline confirmation (`run.confirmGiveUp` with `name: opponentName`, then `run.giveUpYes` / `run.giveUpNo`), following `match-lobby.tsx`'s confirm pattern. `giveUp.useMutation` invalidates `match.get` on success. Show errors through `resolveErrorKey` into `<p role="alert">`, and `run.givingUp` while pending.
- **Board.** `<RunBoard map={data.map} at={data.at} heldKeys={data.heldKeys} bump={bump} pending={pending} />`, and `run.hint` under it in `text-muted text-sm`.

- [ ] **Step 6: Write `src/components/match/match-screen.tsx`, and slim the lobby**

```tsx
"use client";

import { MatchLobby } from "~/components/match/match-lobby";
import { MatchResult } from "~/components/run/match-result";
import { RunView } from "~/components/run/run-view";
import { isTerminal } from "~/match";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * How often an open run checks whether the match ended under it — the
 * opponent gave up, or finished second. It is the whole notification until
 * the realtime layer exists (spec §9.2, Phase 5).
 */
const POLL_MS = 20_000;

/**
 * One URL for the whole match (spec §10.3.1): the lobby until the runs
 * unlock, the run until the match ends, then the result. A match that ended
 * before both mazes were in never had a run to show a result for, so it
 * stays on the lobby, which already explains an abandoned match.
 */
export function MatchScreen({
  matchId,
  initialData,
}: {
  matchId: string;
  initialData: RouterOutputs["match"]["get"];
}) {
  const { data } = api.match.get.useQuery(
    { id: matchId },
    {
      initialData,
      refetchInterval: (query) =>
        query.state.data?.status === "running" ? POLL_MS : false,
    },
  );

  const ran = data.you.hasSubmitted && (data.opponent?.hasSubmitted ?? false);

  if (data.status === "running") {
    return (
      <RunView
        matchId={matchId}
        opponentName={data.opponent?.displayName ?? ""}
      />
    );
  }
  if (isTerminal(data.status) && ran) return <MatchResult matchId={matchId} />;
  return <MatchLobby matchId={matchId} initialData={data} />;
}
```

`MatchResult` is Task 8's. Until then, create `src/components/run/match-result.tsx` exporting a component that renders `null`, so this task builds. Task 8 replaces it.

In `src/app/[locale]/(app)/matches/[id]/page.tsx`, render `<MatchScreen matchId={id} initialData={found} />` instead of `<MatchLobby …>`.

In `match-lobby.tsx`, delete the `data.status === "running"` branch. Rewrite the comment on the final `else` to say the branch covers `drawing`, plus a `complete` match that never reached `running`, which cannot happen: `complete` requires both runs. Remove the now-unused keys from the code.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/components src/app src/styles messages
git commit -m "feat: run through the fog"
```

Then run `pnpm dev`, create a gated match between two browser profiles (seed with `layout: "gated"` from the console as `e2e/support/match.ts` does), and walk `GATED_MAZE_ROUTE` by keyboard. Check that the wall bump shakes and draws, the key appears in the HUD, the gate draws dashed once held, and the waiting state appears on the treasure. Hold an arrow key against a wall and release it: the penalty count must stop within one move of releasing. Report what you saw. Task 9 automates most of it, not the held-key feel.

---

## Task 8: The result screen

**Files:**
- Create: `src/lib/format-elapsed.ts`, `tests/unit/format-elapsed.test.ts`, `src/components/run/result-maze.tsx`
- Modify: `src/components/run/match-result.tsx` (replace the Task 7 stub), `messages/en.json`, `messages/sk.json`

**Interfaces:**
- Consumes: `run.result`; `CELL_PX`, `gateColour`; `edgeKey`, `cellKey`, `type Maze`, `type Point` from `~/maze`.
- Produces:
  - `formatElapsed(ms: number): string` gives `m:ss` under an hour and `h:mm:ss` from an hour up
  - `<MatchResult matchId />`, `<ResultMaze maze path label which />`
  - DOM hooks: `[data-match-result]` with `data-outcome="won|lost|none"` and `data-reason="treasure|tie|gaveUp|timeout|abandoned"`; `[data-score="you"]` and `[data-score="opponent"]`, each containing `[data-penalties="N"]`; `[data-decided-by]`; `[data-result-maze="theirs"]` and `[data-result-maze="yours"]`, each containing one `polyline[data-path]` with `data-points-count="N"`.

- [ ] **Step 1: Write the failing test**

`tests/unit/format-elapsed.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatElapsed } from "~/lib/format-elapsed";

describe("formatElapsed", () => {
  it("shows minutes and zero-padded seconds under an hour", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(247_000)).toBe("4:07");
  });

  it("adds hours from an hour up, padding the minutes", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(26 * 3_600_000 + 5 * 60_000 + 9_000)).toBe("26:05:09");
  });

  it("truncates rather than rounds, so 59.9s never reads as a minute", () => {
    expect(formatElapsed(59_900)).toBe("0:59");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/format-elapsed.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/lib/format-elapsed.ts`**

```ts
/**
 * A run time as a clock reads it. Locale-neutral on purpose: digits and
 * colons read the same in both catalogues, and `Intl.DurationFormat` is not
 * yet in every browser this app supports.
 *
 * Runs are asynchronous and can span a day, so hours are not capped at 24.
 */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours === 0) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
}
```

Run: `pnpm test tests/unit/format-elapsed.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 4: Add the copy**

`messages/en.json`, a top-level `result` namespace:

```json
"result": {
  "won": "You won.",
  "lost": "You lost.",
  "none": "Nobody won.",
  "reasonTreasure": "Both runs reached the treasure.",
  "reasonTie": "The runs tied exactly — penalties, moves and time.",
  "reasonYouGaveUp": "You gave up.",
  "reasonOpponentGaveUp": "{name} gave up.",
  "reasonYouTimedOut": "You ran out of time before finding the treasure.",
  "reasonOpponentTimedOut": "{name} ran out of time before finding the treasure.",
  "reasonAbandoned": "The match expired before it was decided.",
  "decidedByPenalties": "Decided on penalties.",
  "decidedByMoves": "Penalties were level, so moves decided it.",
  "decidedByTime": "Penalties and moves were level, so time decided it.",
  "scoreHeading": "Scores",
  "you": "You",
  "penalties": "Penalties",
  "moves": "Moves",
  "time": "Time",
  "didNotFinish": "Did not finish",
  "theirMaze": "{name}'s labyrinth, and your path through it",
  "yourMaze": "Your labyrinth, and {name}'s path through it",
  "backToMatches": "Back to your matches"
}
```

`messages/sk.json`:

```json
"result": {
  "won": "Vyhrali ste.",
  "lost": "Prehrali ste.",
  "none": "Nikto nevyhral.",
  "reasonTreasure": "Oba behy došli k pokladu.",
  "reasonTie": "Behy skončili presne nerozhodne — v penalizáciách, ťahoch aj čase.",
  "reasonYouGaveUp": "Vzdali ste sa.",
  "reasonOpponentGaveUp": "Súper sa vzdal: {name}.",
  "reasonYouTimedOut": "Vypršal vám čas skôr, než ste našli poklad.",
  "reasonOpponentTimedOut": "Súperovi vypršal čas skôr, než našiel poklad: {name}.",
  "reasonAbandoned": "Zápas vypršal skôr, než sa rozhodol.",
  "decidedByPenalties": "Rozhodli penalizácie.",
  "decidedByMoves": "Penalizácie boli vyrovnané, rozhodol počet ťahov.",
  "decidedByTime": "Penalizácie aj ťahy boli vyrovnané, rozhodol čas.",
  "scoreHeading": "Skóre",
  "you": "Vy",
  "penalties": "Penalizácie",
  "moves": "Ťahy",
  "time": "Čas",
  "didNotFinish": "Nedokončené",
  "theirMaze": "Bludisko hráča {name} a vaša cesta ním",
  "yourMaze": "Vaše bludisko a cesta hráča {name} ním",
  "backToMatches": "Späť na vaše zápasy"
}
```

The Slovak opponent sentences put the name after a colon, or after "hráča". A Slovak past-tense verb agrees with its subject's gender ("vzdal" or "vzdala"), and the app does not know the opponent's. This keeps every sentence grammatical for anyone.

- [ ] **Step 5: Write `src/components/run/result-maze.tsx`**

A client component. Props: `{ maze: Maze; path: readonly Point[]; label: string; which: "theirs" | "yours" }`.

Draw the full maze read-only, using the editor board's visual language: painted cells in `fill-cell-painted stroke-grid-line`, walls in `stroke-wall`, gates in `gateColour`, keys as small circles in `gateColour`, the start in `fill-accent`, the treasure in `fill-danger`. Draw **only painted cells**, since a void square is just background now. The viewBox is the painted cells' bounding box, padded half a cell.

Over the maze, draw `<polyline data-path data-points-count={path.length} points={path.map(p => `${(p.x + 0.5) * CELL_PX},${(p.y + 0.5) * CELL_PX}`).join(" ")} fill="none" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" className="stroke-accent" opacity={0.75} />`. Mark the path's last point with a ring. A revisited corridor overlaps itself, and the overlap is the information.

Wrap it as `<figure data-result-maze={which}>` with `<figcaption>{label}</figcaption>`, and give the `<svg>` `role="img" aria-label={label}`.

- [ ] **Step 6: Write `src/components/run/match-result.tsx`**

A client component over `api.run.result.useQuery({ matchId })`. Render `null` while pending, and show an error through `resolveErrorKey`.

- `<section data-match-result data-outcome={outcome} data-reason={reason}>`.
- Heading: `result.won` / `lost` / `none`, `text-3xl font-bold`.
- Reason line:
  - `gaveUp` uses `reasonYouGaveUp` or `reasonOpponentGaveUp` (by `gaveUpBy`)
  - `timeout` uses `reasonYouTimedOut` when `you.timedOut`, otherwise `reasonOpponentTimedOut`
  - the rest map one to one

  Then `<p data-decided-by={decidedBy}>` with the matching `decidedBy*` line, when `decidedBy` is non-null.
- Scores: a `<table>` captioned `result.scoreHeading`, with columns `result.you` and `opponent.displayName`, and rows penalties, moves and time. Wrap each score cell group in `[data-score="you"|"opponent"]` with `[data-penalties={n}]` on the penalties cell. The time cell shows `formatElapsed(elapsedMs)`, or `result.didNotFinish` when null. Bold the deciding row when `decidedBy` names it.
- Mazes, when `mazes` is non-null: two `<ResultMaze>`, `which="theirs"` labelled `result.theirMaze` and `which="yours"` labelled `result.yourMaze`, both with `name: opponent.displayName`. Side by side from `md:` up, stacked below.
- A link back to `/matches` (`result.backToMatches`) via the localised `Link` from `~/i18n/navigation`.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/components/run src/lib/format-elapsed.ts tests/unit/format-elapsed.test.ts messages
git commit -m "feat: show the result, both labyrinths and both paths"
```

---

## Task 9: End-to-end — play a match to its result

**Files:**
- Create: `e2e/run.spec.ts`, `e2e/support/run.ts`
- Modify: `package.json` (`@axe-core/playwright`)

**Interfaces:**
- Consumes: the `players` fixture and `createMatch` from `e2e/support/match.ts`; `GATED_MAZE_ROUTE` from `~/lib/open-maze` (Playwright resolves the `~` alias through `tsconfig.json`, as `e2e/support` already does; if it does not, copy the 11 directions into `e2e/support/run.ts` with a comment naming their source); every DOM hook in Task 7's and Task 8's Produces blocks.
- Produces: `walk(page, dirs, testInfo)`, `startRunningMatch(players)`.

- [ ] **Step 1: Add axe**

```bash
pnpm add -D @axe-core/playwright@4.10.2
```

- [ ] **Step 2: Write `e2e/support/run.ts`**

```ts
import { expect, type Page, type TestInfo } from "@playwright/test";

import type { Direction } from "~/maze";

import type { test } from "./match";

const KEY: Record<Direction, string> = {
  N: "ArrowUp",
  E: "ArrowRight",
  S: "ArrowDown",
  W: "ArrowLeft",
};

const BUTTON: Record<Direction, string> = {
  N: "Move north",
  E: "Move east",
  S: "Move south",
  W: "Move west",
};

/**
 * Walks a route one move at a time, waiting for the server to answer each
 * before sending the next, so the spec never depends on the queue's
 * one-waiting-slot policy. The keyboard on desktop, the d-pad on mobile —
 * both input paths get driven by the same specs.
 */
export async function walk(
  page: Page,
  dirs: readonly Direction[],
  testInfo: TestInfo,
): Promise<void> {
  const moves = page.locator("[data-moves]");
  let count = Number(await moves.getAttribute("data-moves"));
  for (const dir of dirs) {
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: BUTTON[dir] }).click();
    } else {
      await page.keyboard.press(KEY[dir]);
    }
    count += 1;
    await expect(moves).toHaveAttribute("data-moves", String(count));
  }
}

type Players = Parameters<Parameters<typeof test>[2]>[0]["players"];

/** Two players in a running 36/1 match, each holding a gated seed. */
export async function startRunningMatch(
  players: Players,
  createMatch: (page: Page, o: { cells: number; gates: number }) => Promise<string>,
) {
  const size = { cellCount: 36, gateCount: 1, layout: "gated" as const };
  const host = await players({ name: "Host maze", ...size });
  const guest = await players({ name: "Guest maze", ...size });

  const code = await createMatch(host, { cells: 36, gates: 1 });
  await guest.goto("/en/matches");
  await guest.getByLabel("Join code").fill(code);
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest).toHaveURL(/\/en\/matches\/[^/]+$/);

  for (const page of [host, guest]) {
    await page.reload();
    await page.locator("[data-maze-option]").first().click();
    await page.getByRole("button", { name: "Submit this labyrinth" }).click();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
  }

  await host.reload();
  await expect(host.locator("[data-run-view]")).toBeVisible();
  await expect(guest.locator("[data-run-view]")).toBeVisible();
  return { host, guest };
}
```

If the `Players` type gymnastics fight the compiler, type the parameter as `(options: { name: string; cellCount: number; gateCount: number; layout?: "open" | "gated" }) => Promise<Page>`. That is the fixture's signature, written out.

- [ ] **Step 3: Write `e2e/run.spec.ts`**

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";

import { GATED_MAZE_ROUTE } from "~/lib/open-maze";

import { createMatch, test } from "./support/match";
import { startRunningMatch, walk } from "./support/run";

test.describe("the run", () => {
  test("two players race to the treasure, and the result waits for both", async ({
    players,
  }, testInfo) => {
    const { host, guest } = await startRunningMatch(players, createMatch);

    // The board starts knowing one square.
    await expect(host.locator("[data-run-cell]")).toHaveCount(1);
    await expect(host.locator("[data-runner-at]")).toHaveAttribute(
      "data-runner-at",
      "0,0",
    );

    const route = [...GATED_MAZE_ROUTE];
    // Down onto the key, then into the wall.
    await walk(host, route.slice(0, 2), testInfo);
    await expect(host.locator('[data-held-key="1"]')).toBeVisible();
    await walk(host, route.slice(2, 3), testInfo);
    await expect(host.locator("[data-penalties]")).toHaveAttribute(
      "data-penalties",
      "1",
    );
    await expect(host.locator('[data-run-segment="H:0,2"]')).toBeVisible();

    // Along the wall, through the gate, to the treasure.
    await walk(host, route.slice(3), testInfo);
    await expect(host.locator("[data-run-finished]")).toBeVisible();
    // Withheld: nothing about the guest's run is on the host's screen.
    await expect(host.locator("[data-match-result]")).toHaveCount(0);
    await expect(host.locator('[data-score="opponent"]')).toHaveCount(0);

    // The guest bumps the north boundary first, so the host wins on
    // penalties however the two clocks fell.
    await walk(guest, ["N", ...route], testInfo);
    await expect(guest.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "lost",
    );

    // The host's waiting screen finds out on its next poll.
    await expect(host.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "won",
      { timeout: 30_000 },
    );
    await expect(host.locator("[data-decided-by]")).toHaveAttribute(
      "data-decided-by",
      "penalties",
    );
    await expect(
      host.locator('[data-score="opponent"] [data-penalties]'),
    ).toHaveAttribute("data-penalties", "2");
    await expect(
      host.locator('[data-result-maze="theirs"] [data-path]'),
    ).toHaveAttribute("data-points-count", "11");
    await expect(
      host.locator('[data-result-maze="yours"] [data-path]'),
    ).toHaveAttribute("data-points-count", "11");
  });

  test("giving up ends the match for both players", async ({
    players,
  }, testInfo) => {
    const { host, guest } = await startRunningMatch(players, createMatch);
    await walk(guest, ["S"], testInfo);

    await host.getByRole("button", { name: "Give up" }).click();
    await host.getByRole("button", { name: "Yes, give up" }).click();
    await expect(host.locator("[data-match-result]")).toHaveAttribute(
      "data-reason",
      "gaveUp",
    );
    await expect(host.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "lost",
    );

    // The guest is told without doing anything: the open run view polls.
    await expect(guest.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "won",
      { timeout: 30_000 },
    );
  });

  test("the run view passes axe", async ({ players }) => {
    const { host } = await startRunningMatch(players, createMatch);
    const results = await new AxeBuilder({ page: host })
      .include("[data-run-view]")
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
```

- [ ] **Step 4: Check what is serving port 3000 before trusting anything**

Run: `lsof -iTCP:3000 -sTCP:LISTEN`

`reuseExistingServer` is on locally. If a `pnpm dev` from Task 7's manual check is still running, Playwright will test it, without `E2E_TEST_SUPPORT` and possibly on old code. Stop it first.

- [ ] **Step 5: Run the suite**

Run: `pnpm e2e`
Expected: every spec passes in both projects, including the 3 new ones, with Phase 3's `e2e/match.spec.ts` unchanged. The polling tests can take up to 20s each. That is the poll interval, not a hang.

- [ ] **Step 6: Break it and watch it fail**

1. In `MatchScreen`, set `refetchInterval` to `false`. Both "the result waits for both" and "giving up ends the match" must time out waiting for the other player's result.
2. In `RunBoard`, render the treasure cell from the start. Nothing here will catch it. That is an honest gap: the "nothing undiscovered" rule is proved by the router tests (Task 5) and by review, not by e2e.

Restore the first change. Note the second in the task report.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add e2e package.json pnpm-lock.yaml
git commit -m "test: play a match to its result, and give one up, end to end"
```

---

## Task 10: Close the phase out in the docs

**Files:**
- Modify: `docs/backlog.md`, `src/maze/AGENTS.md` (only if it lists modules), `README.md` (only if it describes the app's state)

- [ ] **Step 1: Update `docs/backlog.md`**

- Delete **"Rematch, and reusing a maze from a finished match's result screen"** from "Waiting on a later phase", and add it to "Product, not yet scheduled" with: "(Phase 3; the result screen now exists, Phase 4)".
- Keep **"Live 'opponent gave up' push"** and **"Live lobby updates"** under Phase 5.
- Add under "Technical": **"The run board's 'nothing undiscovered' rule has no browser-level test"** (Phase 4). The router tests prove `run.get` returns only discovered cells, but nothing proves `RunBoard` draws only what it is given. An e2e test that counts `[data-run-cell]` against moves made would close it.
- Add under "Product, not yet scheduled": **"A key cell re-announces its key on every visit"** (Phase 4). The reducer reports `moved_found_key` each time a runner steps onto a key cell they have already emptied, and the run view announces it. That is harmless, but it reads oddly. The fix belongs in the reducer, and it changes the stored delta, so it needs a replay-compatibility thought first.

- [ ] **Step 2: Check the module lists**

If `src/maze/AGENTS.md` enumerates the domain's modules, add `run.ts` with one line: "the discovered map and the stored run". Do not touch `README.md` unless it describes what the app can do. It currently says nothing about phases.

- [ ] **Step 3: Commit**

```bash
pnpm format && pnpm format:check
git add docs src/maze/AGENTS.md
git commit -m "docs: close out Phase 4 in the backlog"
```

---

## Self-review

**Spec coverage.**
- §2.2 movement and §2.5 keys and gates are applied by the existing reducer, and exercised through the router in Task 5 and end to end in Task 9.
- §2.4 fog → Task 1 (`DiscoveredMap`, with property tests that it holds exactly what was touched) and Task 7 (the board draws only that).
- §2.6 scoring, tiebreakers and the perfect tie → Task 2.
- §6 run columns and the `move` table → Task 3, with the deviations written back into the spec.
- §7 move procedure, §7.1 anti-cheat and §7.2 idempotency → Task 5. §7.3 no optimistic movement and the held-key queue → Task 7.
- §9.1, all seven rows: row 6 is fixed in Task 2, and rows 6–7 are wired through `situationFor` in Task 3 and tested through the sweep in Task 6.
- §9.2 giving up → Tasks 2 and 6, and end to end in Task 9.
- §10.3 run view → Task 7. §10.3.1 result → Tasks 6 and 8.
- §11 errors: `RunNotUnlocked` and `RunAlreadyFinished` (named in the spec), plus `matchOver`, `moveOutOfOrder` and `resultNotReady` → Tasks 5 and 6.
- §12 testing:
  - The reducer property suite grows in Task 1.
  - Integration tests on real Postgres in Tasks 3, 5 and 6.
  - The e2e run that bumps a wall, collects a key, opens its gate and reaches the treasure, and the result staying hidden until the second player finishes → Task 9.
  - axe on the run view → Task 9.
  - Keyboard-operable run view → Task 7, and driven by keyboard in Task 9's desktop project.

**Gaps found and closed during review:**
1. §9.1's one-moved row was never implemented. Task 2 implements it, and Review Focus 4 names it.
2. The result could have revealed a maze from a match abandoned in `drawing`. Task 6 guards it, and Review Focus 3 tests it.
3. A give-up after the deadline would have turned a no-winner expiry into a win. Task 6 refuses it.
4. `AGENTS.md` invariant 7 contradicted §9.2. Task 2 amends it.

**Type consistency.**
- `StoredRun`, `RunView`, `DiscoveredMap`, `freshRun`, `advanceRun`, `recordDelta`, `heldKeys`, `pathFrom` and `SERVER_OUTCOMES` are defined in Task 1 and used under those names in Tasks 3, 5, 6 and 7.
- `RunFacts`, `resolveCompletion`, `decidingField` and `elapsedMs` are defined in Task 2 and used in Tasks 5 and 6.
- `participantRows(…, { lock })`, `notYours` and `DbClient` are defined in Task 3 and used in Tasks 5 and 6.
- `factsFor` and `assertRunOpen` are defined in Task 5 and reused in Task 6.
- `gatedMazeDraft`, `GATED_MAZE_ROUTE` and `GATED_MAZE_*` are defined in Task 4 and used in Tasks 5, 6 and 9.
- The result's `outcome`/`reason`/`gaveUpBy`/`decidedBy` spellings are defined in Task 6's Produces block, and Task 8's DOM hooks and Task 9's assertions use the same strings.

**A caution about counts.** Every "Expected: PASS, N tests" is a count I made by reading my own test code. Phase 3 found such counts wrong three times while the code itself was right. Treat a mismatch as a defect in this document, report it, and move on.

**A caution about Drizzle's `.for("update")`.** It exists on Postgres select builders in `drizzle-orm` 0.41. If the ternary in `participantRows` fights the builder's types, build the query in two branches instead. Do not drop the lock: Task 5 Step 8 shows what it prevents.
