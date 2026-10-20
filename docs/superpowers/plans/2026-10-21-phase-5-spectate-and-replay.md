# Phase 5 — Spectate and Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player whose own run is over can watch the opponent walk their maze live. Both players can replay both runs once the match ends. The runner sees a "watching" badge. The lobby and the run view update the moment something changes, without polling.

**Architecture:** The server publishes after commit through a `RealtimePublisher`: Pusher when keys are configured, and otherwise an in-memory bus that a server-sent-events route streams to the browser. Every subscription is authorised by one rule (`maySubscribe`) through `canSubscribe`, which both the Pusher auth endpoint and the local stream call. The client's `useChannel` hook hides which transport is in use. Replay and live watching are one pure timeline (`mergeMoves` → `playable` → `frameAt`) driven by one pure playback reducer, rendered as two boards: the Phase 4 `RunBoard` for what the runner saw, and `ResultMaze` for the whole maze.

**Tech Stack:** Next.js App Router (route handlers on the Node runtime), tRPC, Drizzle on Neon, Better Auth, next-intl, Tailwind v4, Vitest, fast-check, Playwright, `pusher` (server SDK, new), `pusher-js` (client, new).

**Spec:** `docs/superpowers/specs/2026-09-22-labyrinth-design.md`: §8 (realtime, the watching gate, channels, publish-never-fails, replay pace and access), §8.1 (publisher abstraction and the local transport), §9 (the result is withheld), §10.4 (the two-board viewer and the watch page), §12 (testing).

## Global Constraints

- **Purity.** `src/maze/**`, `src/match/**` and `src/lib/issues.ts` import nothing from Next, React, tRPC, Drizzle, Better Auth, next-intl, `@t3-oss/*`, `@neondatabase/*`, Node builtins, or the `~/server`, `~/app`, `~/components`, `~/trpc`, `~/i18n`, `~/env`, `~/styles` aliases (AGENTS.md invariant 2). `src/match` may import `~/maze`.
- **Watching opens only when your own run is over** (§8). You may join the opponent's run channel, or `run.replay({ whose: "opponent" })`, only once your `finishedAt` is set or the match is terminal, and only if both mazes were submitted. Your own run, through their maze, only once the match is terminal and both submitted.
- **One subscription rule.** `maySubscribe` (pure) decides it. `canSubscribe` (server) is the only caller of `maySubscribe`, and both `/api/realtime/auth` and `/api/realtime/stream` go through it.
- **Publishing never fails a move or a lifecycle change.** Publish after the transaction commits, through `publishSafely`, which logs and swallows errors.
- **Pings carry no data.** `match` channel events have an empty payload, so the client refetches through the ordinary procedures.
- **Move events are `{ seq, delta }`**, where `delta` is exactly the stored runner delta. A retried `seq` publishes nothing.
- **Replay runs at a fixed pace:** 1× is 4 moves a second. Speeds are 1, 2, 4, 8.
- **The runner never receives `maze.data`** (invariant 1). `run.replay` is the third sanctioned reader: your own maze for `"opponent"`, and theirs for `"mine"`, but only once the match is over.
- **Errors travel as i18n keys**, both catalogues, with identical key sets and natural Slovak using formal "vy".
- **Colours come from tokens and `gateColour`** (invariant 10). Animations are `motion-safe:` only.
- **Migrations:** none in this phase.
- **Env:** the Pusher variables are all optional. A deployment without them must still work, falling back to polling.

## Review Focus

1. **A watcher's connection drops mid-run and comes back.** Expected: no move is lost or duplicated. The view refetches the log and merges by `seq`. → Task 2 (`mergeMoves` property test), Task 8 (`onReconnect` refetch).
2. **A move event arrives ahead of an earlier one** (out-of-order delivery, or a gap after a reconnect). Expected: the timeline plays only the unbroken prefix from seq 1, and the late move fills the gap. → Task 2, "plays only the unbroken prefix".
3. **A watcher closes the tab.** Expected: the runner's badge goes back to zero, because the stream route leaves presence on abort. → Task 6, "leaving drops the member count".
4. **The publisher throws during a move.** Expected: the move still commits and returns its delta. → Task 4, "a publisher that throws does not fail the move".
5. **A player who has not finished opens the watch page.** Expected: the "finish your own run first" message, not a crash and not the opponent's moves. → Task 5 (router), Task 9 (e2e).

## What Phase 5 does *not* build

- A public replay link, or watching from outside the match (§8: nobody outside the match).
- Notifications to a player who is not on the page.
- Reference-counting a channel subscribed twice on one page. No page does this. `useChannel`'s doc comment says so.

## File Structure

| File | Responsibility |
|---|---|
| `src/match/channels.ts` | Channel names, parsing, event names. Pure. |
| `src/match/watch.ts` | `WatchFacts`, `mayWatchOpponent`, `mayReplayOwn`, `maySubscribe`. Pure. |
| `src/maze/replay.ts` | `LoggedMove`, `mergeMoves`, `playable`, `frameAt`. Pure. |
| `src/maze/playback.ts` | The scrubber, play, speed and live-follow reducer. Pure. |
| `src/server/realtime/local-bus.ts` | The in-memory bus: channels, listeners, presence. |
| `src/server/realtime/index.ts` | The active publisher, `publishSafely`, `getPusher`, `swapPublisherForTests`. |
| `src/server/realtime/events.ts` | `publishMove`, `publishMatchChanged`. |
| `src/server/realtime/access.ts` | `watchFactsFor`, `canSubscribe`. |
| `src/app/api/realtime/stream/route.ts` | The local SSE stream, with presence. |
| `src/app/api/realtime/auth/route.ts` | Pusher channel authorisation. |
| `src/components/realtime/use-channel.ts` | The client hook, over Pusher or `EventSource`. |
| `src/components/watch/watch-view.tsx` | The two-board viewer with its controls. |
| `src/app/[locale]/(app)/matches/[id]/watch/page.tsx` | The watch and replay page. |
| `tests/smoke/pusher.test.ts`, `vitest.smoke.config.ts`, `.github/workflows/nightly-pusher.yml` | The nightly smoke test against real Pusher. |

---

## Task 1: Channels and the watching rules

**Files:**
- Create: `src/match/channels.ts`, `src/match/watch.ts`, `tests/unit/match/channels.test.ts`, `tests/unit/match/watch.test.ts`
- Modify: `src/match/index.ts`

**Interfaces:**
- Produces:
  - `runChannel(matchId: string, runnerId: string): string`, `matchChannel(matchId: string): string`
  - `type ParsedChannel = { kind: "run"; matchId: string; runnerId: string } | { kind: "match"; matchId: string }`
  - `parseChannel(name: string): ParsedChannel | null`, `isPresenceChannel(name: string): boolean`
  - `EVENTS = { move: "move", changed: "changed", members: "realtime:members" } as const`
  - `type WatchFacts = { status: MatchStatus; you: { userId: string; submittedAt: Date | null; finishedAt: Date | null }; opponent: { userId: string; submittedAt: Date | null } | null }`
  - `mayWatchOpponent(f: WatchFacts): boolean`, `mayReplayOwn(f: WatchFacts): boolean`, `maySubscribe(channel: ParsedChannel, f: WatchFacts): boolean`

The ids that go into channel names never contain `_`: match ids are UUIDs, and Better Auth user ids are alphanumeric. Pusher requires the `presence-` and `private-` prefixes, and allows `_` in names.

- [ ] **Step 1: Write the failing tests**

`tests/unit/match/channels.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  isPresenceChannel,
  matchChannel,
  parseChannel,
  runChannel,
} from "~/match";

const MATCH = "0794b64a-2899-48b1-b9a0-80fe4b4b59a2";
const USER = "n00PIhOWnzpwevDVa8MCWx162Oi9inDa";

describe("channel names", () => {
  it("round-trips a run channel", () => {
    const name = runChannel(MATCH, USER);
    expect(name).toBe(`presence-run_${MATCH}_${USER}`);
    expect(parseChannel(name)).toEqual({
      kind: "run",
      matchId: MATCH,
      runnerId: USER,
    });
    expect(isPresenceChannel(name)).toBe(true);
  });

  it("round-trips a match channel", () => {
    const name = matchChannel(MATCH);
    expect(name).toBe(`private-match_${MATCH}`);
    expect(parseChannel(name)).toEqual({ kind: "match", matchId: MATCH });
    expect(isPresenceChannel(name)).toBe(false);
  });

  it("rejects anything else", () => {
    for (const name of [
      "",
      "presence-run_",
      `presence-run_${MATCH}`,
      `presence-run_${MATCH}_${USER}_extra`,
      `presence-run__${USER}`,
      "private-match_",
      `private-match_${MATCH}_x`,
      `public-${MATCH}`,
      MATCH,
    ]) {
      expect(parseChannel(name)).toBeNull();
    }
  });
});
```

`tests/unit/match/watch.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  MATCH_STATUSES,
  mayReplayOwn,
  maySubscribe,
  mayWatchOpponent,
  type WatchFacts,
} from "~/match";

const T = new Date("2026-01-01T00:00:00Z");

function facts(over: {
  status?: WatchFacts["status"];
  youSubmitted?: boolean;
  youFinished?: boolean;
  themSubmitted?: boolean;
  noOpponent?: boolean;
}): WatchFacts {
  return {
    status: over.status ?? "running",
    you: {
      userId: "me",
      submittedAt: over.youSubmitted === false ? null : T,
      finishedAt: over.youFinished ? T : null,
    },
    opponent: over.noOpponent
      ? null
      : { userId: "them", submittedAt: over.themSubmitted === false ? null : T },
  };
}

describe("mayWatchOpponent — §8, watching opens when your run is over", () => {
  it("refuses while your own run is still going", () => {
    expect(mayWatchOpponent(facts({}))).toBe(false);
  });

  it("allows once you have found the treasure", () => {
    expect(mayWatchOpponent(facts({ youFinished: true }))).toBe(true);
  });

  it("allows once the match is over, whoever finished", () => {
    expect(mayWatchOpponent(facts({ status: "complete" }))).toBe(true);
    expect(mayWatchOpponent(facts({ status: "abandoned" }))).toBe(true);
  });

  it("refuses when either maze was never submitted, even after the end", () => {
    expect(
      mayWatchOpponent(facts({ status: "abandoned", themSubmitted: false })),
    ).toBe(false);
    expect(
      mayWatchOpponent(facts({ status: "abandoned", youSubmitted: false })),
    ).toBe(false);
    expect(
      mayWatchOpponent(facts({ status: "abandoned", noOpponent: true })),
    ).toBe(false);
  });
});

describe("mayReplayOwn — your run through their maze", () => {
  it("only once the match is over and both submitted", () => {
    expect(mayReplayOwn(facts({ youFinished: true }))).toBe(false);
    expect(mayReplayOwn(facts({ status: "complete" }))).toBe(true);
    expect(
      mayReplayOwn(facts({ status: "abandoned", themSubmitted: false })),
    ).toBe(false);
  });

  it("is never looser than watching the opponent", () => {
    for (const status of MATCH_STATUSES)
      for (const youFinished of [false, true])
        for (const themSubmitted of [false, true]) {
          const f = facts({ status, youFinished, themSubmitted });
          if (mayReplayOwn(f)) expect(mayWatchOpponent(f)).toBe(true);
        }
  });
});

describe("maySubscribe", () => {
  const run = (runnerId: string) =>
    ({ kind: "run", matchId: "m", runnerId }) as const;

  it("lets a runner join their own run channel at any time", () => {
    expect(maySubscribe(run("me"), facts({}))).toBe(true);
  });

  it("gates the opponent's run channel like watching", () => {
    expect(maySubscribe(run("them"), facts({}))).toBe(false);
    expect(maySubscribe(run("them"), facts({ youFinished: true }))).toBe(true);
  });

  it("refuses a run channel for someone not in the match", () => {
    expect(maySubscribe(run("stranger"), facts({ status: "complete" }))).toBe(
      false,
    );
  });

  it("lets both players join the match channel", () => {
    expect(maySubscribe({ kind: "match", matchId: "m" }, facts({}))).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/unit/match/channels.test.ts tests/unit/match/watch.test.ts`
Expected: FAIL, `runChannel` is not exported from `~/match`.

- [ ] **Step 3: Write `src/match/channels.ts`**

```ts
/**
 * Spec §8. Pusher needs the `presence-` and `private-` prefixes; the ids
 * inside never contain "_" (match ids are UUIDs, Better Auth user ids are
 * alphanumeric), so "_" separates them unambiguously.
 */
const RUN_PREFIX = "presence-run_";
const MATCH_PREFIX = "private-match_";

/** A runner's moves, as they happen. Presence: the members are the watchers. */
export function runChannel(matchId: string, runnerId: string): string {
  return `${RUN_PREFIX}${matchId}_${runnerId}`;
}

/** Payload-free "something changed" pings for both players. */
export function matchChannel(matchId: string): string {
  return `${MATCH_PREFIX}${matchId}`;
}

export type ParsedChannel =
  | { kind: "run"; matchId: string; runnerId: string }
  | { kind: "match"; matchId: string };

export function parseChannel(name: string): ParsedChannel | null {
  if (name.startsWith(RUN_PREFIX)) {
    const parts = name.slice(RUN_PREFIX.length).split("_");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { kind: "run", matchId: parts[0], runnerId: parts[1] };
  }
  if (name.startsWith(MATCH_PREFIX)) {
    const matchId = name.slice(MATCH_PREFIX.length);
    if (!matchId || matchId.includes("_")) return null;
    return { kind: "match", matchId };
  }
  return null;
}

export function isPresenceChannel(name: string): boolean {
  return name.startsWith("presence-");
}

/**
 * Event names, shared by server and client. `members` is ours, not
 * Pusher's: the local stream sends it, and `useChannel` maps Pusher's own
 * member events onto the same callback.
 */
export const EVENTS = {
  move: "move",
  changed: "changed",
  members: "realtime:members",
} as const;
```

- [ ] **Step 4: Write `src/match/watch.ts`**

```ts
import type { ParsedChannel } from "./channels";
import { isTerminal, type MatchStatus } from "./status";

/** What the watching rules need to know, from one player's point of view. */
export type WatchFacts = {
  status: MatchStatus;
  you: { userId: string; submittedAt: Date | null; finishedAt: Date | null };
  opponent: { userId: string; submittedAt: Date | null } | null;
};

function bothSubmitted(f: WatchFacts): boolean {
  return (
    f.opponent !== null &&
    f.you.submittedAt !== null &&
    f.opponent.submittedAt !== null
  );
}

/**
 * Spec §8: you may watch the opponent walk your maze only once your own run
 * is over. Before that, their live progress would be a known target to play
 * to, which is what withholding the result (§9) exists to prevent.
 */
export function mayWatchOpponent(f: WatchFacts): boolean {
  if (!bothSubmitted(f)) return false;
  return f.you.finishedAt !== null || isTerminal(f.status);
}

/**
 * Your own run, through the opponent's maze: only once the match is over —
 * the same rule as the result screen (§10.3.1), since it shows their maze.
 */
export function mayReplayOwn(f: WatchFacts): boolean {
  return bothSubmitted(f) && isTerminal(f.status);
}

/**
 * The one subscription rule (§8.1). The caller has already established that
 * `f.you` is a participant in `channel.matchId`; this decides which of that
 * match's channels they may join.
 */
export function maySubscribe(channel: ParsedChannel, f: WatchFacts): boolean {
  if (channel.kind === "match") return true;
  // A runner joins their own channel only to count the watchers.
  if (channel.runnerId === f.you.userId) return true;
  if (f.opponent && channel.runnerId === f.opponent.userId) {
    return mayWatchOpponent(f);
  }
  return false;
}
```

Add `export * from "./channels";` and `export * from "./watch";` to `src/match/index.ts`.

- [ ] **Step 5: Run the tests**

Run: `pnpm test tests/unit/match`
Expected: PASS. `channels.test.ts` has 3 tests and `watch.test.ts` has 10.

- [ ] **Step 6: Break it and watch it fail**

In `mayWatchOpponent`, delete `|| isTerminal(f.status)`. "allows once the match is over" must fail. Restore it.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add src/match tests/unit/match
git commit -m "feat: add realtime channel names and the watching rules"
```

---

## Task 2: The replay timeline and playback

**Files:**
- Create: `src/maze/replay.ts`, `src/maze/playback.ts`, `tests/unit/maze/replay.test.ts`, `tests/unit/maze/playback.test.ts`
- Modify: `src/maze/index.ts`

**Interfaces:**
- Consumes: `emptyMap`, `recordDelta`, `heldKeys`, `pathFrom`, `DiscoveredMap` from `./run`; `RunnerDelta` from `./reduce`; `advanceRun`, `freshRun` (tests).
- Produces:
  - `type LoggedMove = { seq: number; delta: RunnerDelta }`, which is also the `move` event payload
  - `mergeMoves(known: readonly LoggedMove[], incoming: readonly LoggedMove[]): LoggedMove[]`
  - `playable(moves: readonly LoggedMove[]): LoggedMove[]`
  - `type Frame = { map: DiscoveredMap; at: Point; penalties: number; moves: number; finished: boolean; heldKeys: number[]; last: RunnerDelta | null; path: Point[] }`
  - `frameAt(moves: readonly LoggedMove[], step: number): Frame`
  - `SPEEDS = [1, 2, 4, 8] as const`, `type Speed`, `BASE_MOVES_PER_SECOND = 4`, `tickMs(speed: Speed): number`
  - `type Playback = { step: number; length: number; playing: boolean; speed: Speed; live: boolean; following: boolean }`
  - `type PlaybackAction = { type: "tick" } | { type: "scrub"; step: number } | { type: "play" } | { type: "pause" } | { type: "speed"; speed: Speed } | { type: "arrived"; length: number; live: boolean } | { type: "jumpToLive" }`
  - `initialPlayback(length: number, live: boolean): Playback`, `playback(state: Playback, action: PlaybackAction): Playback`

- [ ] **Step 1: Write the failing tests**

`tests/unit/maze/replay.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GATED_MAZE_ROUTE, gatedMazeDraft } from "~/lib/open-maze";
import { advanceRun, freshRun, mazeSchema } from "~/maze";
import {
  frameAt,
  mergeMoves,
  playable,
  type LoggedMove,
} from "~/maze/replay";

/** The gated seed walked by its route: 11 logged moves, 1 penalty. */
function loggedRoute(): LoggedMove[] {
  const maze = mazeSchema.parse(gatedMazeDraft());
  let run = freshRun(maze);
  return GATED_MAZE_ROUTE.map((dir, i) => {
    const step = advanceRun(run, maze, dir);
    run = step.run;
    return { seq: i + 1, delta: step.delta };
  });
}

describe("frameAt", () => {
  it("is the start at step 0", () => {
    const frame = frameAt(loggedRoute(), 0);
    expect(frame).toMatchObject({
      at: { x: 0, y: 0 },
      penalties: 0,
      moves: 0,
      finished: false,
      last: null,
      path: [{ x: 0, y: 0 }],
    });
    expect(frame.map.cells).toEqual([{ x: 0, y: 0 }]);
  });

  it("matches the run at every step", () => {
    const moves = loggedRoute();
    const maze = mazeSchema.parse(gatedMazeDraft());
    let run = freshRun(maze);
    for (const [i, dir] of GATED_MAZE_ROUTE.entries()) {
      run = advanceRun(run, maze, dir).run;
      const frame = frameAt(moves, i + 1);
      expect(frame.map).toEqual(run.view.map);
      expect(frame.at).toEqual(run.view.at);
      expect(frame.penalties).toBe(run.state.penalties);
    }
  });

  it("clamps a step outside the timeline", () => {
    const moves = loggedRoute();
    expect(frameAt(moves, -3)).toEqual(frameAt(moves, 0));
    expect(frameAt(moves, 99)).toEqual(frameAt(moves, moves.length));
    expect(frameAt(moves, 99).finished).toBe(true);
  });
});

describe("mergeMoves and playable", () => {
  it("is the same whatever order and duplication the moves arrive in", () => {
    const moves = loggedRoute();
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: moves.length - 1 }), {
          maxLength: 40,
        }),
        fc.integer({ min: 0, max: moves.length }),
        (arrivals, knownCount) => {
          const known = moves.slice(0, knownCount);
          const incoming = arrivals.map((i) => moves[i]!);
          const merged = mergeMoves(known, incoming);
          const seqs = merged.map((m) => m.seq);
          expect(seqs).toEqual([...new Set(seqs)].sort((a, b) => a - b));
          // Everything known or arrived is there, exactly once.
          const expected = new Set([
            ...known.map((m) => m.seq),
            ...incoming.map((m) => m.seq),
          ]);
          expect(new Set(seqs)).toEqual(expected);
        },
      ),
    );
  });

  it("keeps the first copy of a seq it already has", () => {
    const [first] = loggedRoute();
    const impostor = { seq: 1, delta: { ...first!.delta, penalties: 99 } };
    expect(mergeMoves([first!], [impostor])).toEqual([first]);
  });

  it("plays only the unbroken prefix from seq 1", () => {
    const moves = loggedRoute();
    const withGap = mergeMoves([], [moves[0]!, moves[1]!, moves[3]!]);
    expect(playable(withGap).map((m) => m.seq)).toEqual([1, 2]);
    const filled = mergeMoves(withGap, [moves[2]!]);
    expect(playable(filled).map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(playable(mergeMoves([], [moves[4]!]))).toEqual([]);
  });
});
```

`tests/unit/maze/playback.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { initialPlayback, playback, tickMs } from "~/maze/playback";

describe("initialPlayback", () => {
  it("starts a finished replay at the beginning, paused", () => {
    expect(initialPlayback(11, false)).toEqual({
      step: 0,
      length: 11,
      playing: false,
      speed: 1,
      live: false,
      following: false,
    });
  });

  it("starts a live view at the newest move, following", () => {
    expect(initialPlayback(5, true)).toMatchObject({
      step: 5,
      following: true,
    });
  });
});

describe("playback", () => {
  it("steps forward on each tick and stops at the end", () => {
    let s = playback(initialPlayback(2, false), { type: "play" });
    s = playback(s, { type: "tick" });
    expect(s.step).toBe(1);
    s = playback(s, { type: "tick" });
    expect(s).toMatchObject({ step: 2, playing: true });
    s = playback(s, { type: "tick" });
    expect(s).toMatchObject({ step: 2, playing: false });
  });

  it("restarts a finished replay from the beginning on play", () => {
    const atEnd = playback(initialPlayback(3, false), { type: "scrub", step: 3 });
    expect(playback(atEnd, { type: "play" })).toMatchObject({
      step: 0,
      playing: true,
    });
  });

  it("follows new moves while at the live edge", () => {
    const s = playback(initialPlayback(5, true), {
      type: "arrived",
      length: 6,
      live: true,
    });
    expect(s).toMatchObject({ step: 6, length: 6, following: true });
  });

  it("stays put when scrubbed back, and jumps on request", () => {
    let s = playback(initialPlayback(5, true), { type: "scrub", step: 2 });
    expect(s.following).toBe(false);
    s = playback(s, { type: "arrived", length: 7, live: true });
    expect(s).toMatchObject({ step: 2, length: 7, following: false });
    s = playback(s, { type: "jumpToLive" });
    expect(s).toMatchObject({ step: 7, following: true });
  });

  it("follows again once a scrub reaches the live edge", () => {
    const back = playback(initialPlayback(5, true), { type: "scrub", step: 1 });
    expect(playback(back, { type: "scrub", step: 5 }).following).toBe(true);
  });

  it("never shrinks the timeline or scrubs past it", () => {
    let s = initialPlayback(5, true);
    s = playback(s, { type: "arrived", length: 3, live: true });
    expect(s.length).toBe(5);
    s = playback(s, { type: "scrub", step: 40 });
    expect(s.step).toBe(5);
    s = playback(s, { type: "scrub", step: -2 });
    expect(s.step).toBe(0);
  });

  it("stops following when the run ends", () => {
    const s = playback(initialPlayback(5, true), {
      type: "arrived",
      length: 6,
      live: false,
    });
    expect(s).toMatchObject({ step: 6, live: false, following: false });
  });

  it("ticks four moves a second at 1×", () => {
    expect(tickMs(1)).toBe(250);
    expect(tickMs(8)).toBe(31.25);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/unit/maze/replay.test.ts tests/unit/maze/playback.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/maze/replay.ts`**

```ts
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
```

- [ ] **Step 4: Write `src/maze/playback.ts`**

```ts
/** Spec §8: replay runs at a fixed pace, not the recorded intervals. */
export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];
export const BASE_MOVES_PER_SECOND = 4;

export function tickMs(speed: Speed): number {
  return 1000 / (BASE_MOVES_PER_SECOND * speed);
}

/**
 * The viewer's position in the timeline. `live` means the run is still
 * going; `following` means the viewer is at the live edge and new moves
 * should carry them along. A viewer who scrubs back stops following until
 * they return to the edge or jump to it.
 */
export type Playback = {
  step: number;
  length: number;
  playing: boolean;
  speed: Speed;
  live: boolean;
  following: boolean;
};

export type PlaybackAction =
  | { type: "tick" }
  | { type: "scrub"; step: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "speed"; speed: Speed }
  | { type: "arrived"; length: number; live: boolean }
  | { type: "jumpToLive" };

export function initialPlayback(length: number, live: boolean): Playback {
  return {
    step: live ? length : 0,
    length,
    playing: false,
    speed: 1,
    live,
    following: live,
  };
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));

export function playback(state: Playback, action: PlaybackAction): Playback {
  switch (action.type) {
    case "tick": {
      if (state.step >= state.length) return { ...state, playing: false };
      const step = state.step + 1;
      return { ...state, step, following: state.live && step === state.length };
    }
    case "scrub": {
      const step = clamp(action.step, state.length);
      return { ...state, step, following: state.live && step === state.length };
    }
    case "play":
      // At the end of a finished run, play means "watch it again".
      if (state.step >= state.length && !state.live) {
        return { ...state, step: 0, playing: true, following: false };
      }
      return { ...state, playing: true };
    case "pause":
      return { ...state, playing: false };
    case "speed":
      return { ...state, speed: action.speed };
    case "arrived": {
      const length = Math.max(state.length, action.length);
      return {
        ...state,
        length,
        live: action.live,
        step: state.following ? length : state.step,
        following: state.following && action.live,
      };
    }
    case "jumpToLive":
      return {
        ...state,
        step: state.length,
        playing: false,
        following: state.live,
      };
  }
}
```

Add `export * from "./replay";` and `export * from "./playback";` to `src/maze/index.ts`.

- [ ] **Step 5: Run the tests**

Run: `pnpm test tests/unit/maze`
Expected: PASS. `replay.test.ts` has 6 tests and `playback.test.ts` has 10.

- [ ] **Step 6: Break it and watch it fail**

In `playable`, replace the loop body with `out.push(m)` (no gap check). "plays only the unbroken prefix" must fail. Restore it.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add src/maze tests/unit/maze
git commit -m "feat: add the replay timeline and playback controls"
```

---

## Task 3: The publisher

**Files:**
- Create: `src/server/realtime/local-bus.ts`, `src/server/realtime/index.ts`, `src/server/realtime/events.ts`, `tests/unit/realtime/local-bus.test.ts`, `tests/integration/realtime-publisher.test.ts`
- Modify: `src/env.js`, `package.json` (`pusher`)

**Interfaces:**
- Consumes: `runChannel`, `matchChannel`, `EVENTS` from `~/match`; `LoggedMove` from `~/maze`.
- Produces:
  - `type RealtimePublisher = { publish(channel: string, event: string, data: unknown): Promise<void> }`
  - `local-bus.ts`: `subscribe(channel, listener: (event: string, data: unknown) => void): () => void`, `emit(channel, event, data): void`, `join(channel, userId): () => void`, `memberCount(channel): number`, `localPublisher: RealtimePublisher`
  - `index.ts`: `pusherConfigured: boolean`, `getPusher(): Pusher | null`, `publishSafely(channel, event, data): Promise<void>`, `swapPublisherForTests(p: RealtimePublisher): () => void`
  - `events.ts`: `publishMove(matchId: string, runnerId: string, move: LoggedMove): Promise<void>`, `publishMatchChanged(matchId: string): Promise<void>`
  - env: server `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`; client `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`. All optional.

- [ ] **Step 1: Add the dependency and the env**

```bash
pnpm add pusher@5
```

In `src/env.js`, add to `server`:

```js
    // Spec §8.1. All four or none: without them the server publishes to the
    // in-process bus, which only reaches browsers on the same Node process
    // (local dev, `next start`, the e2e suite). A deployment without them
    // still works — clients fall back to polling.
    PUSHER_APP_ID: z.string().optional(),
    PUSHER_KEY: z.string().optional(),
    PUSHER_SECRET: z.string().optional(),
    PUSHER_CLUSTER: z.string().optional(),
```

add to `client`:

```js
    // The public half of the Pusher config. Set both, or the client uses the
    // local event stream.
    NEXT_PUBLIC_PUSHER_KEY: z.string().optional(),
    NEXT_PUBLIC_PUSHER_CLUSTER: z.string().optional(),
```

and the six matching `runtimeEnv` entries (`PUSHER_APP_ID: process.env.PUSHER_APP_ID`, and so on).

- [ ] **Step 2: Write the failing bus test**

`tests/unit/realtime/local-bus.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  emit,
  join,
  memberCount,
  subscribe,
} from "~/server/realtime/local-bus";

const unique = () => `presence-run_${crypto.randomUUID()}_u`;

describe("the local bus", () => {
  it("delivers to subscribers of that channel only", () => {
    const a = unique();
    const b = unique();
    const got: unknown[] = [];
    const off = subscribe(a, (event, data) => got.push([event, data]));
    emit(a, "move", { seq: 1 });
    emit(b, "move", { seq: 2 });
    off();
    emit(a, "move", { seq: 3 });
    expect(got).toEqual([["move", { seq: 1 }]]);
  });

  it("keeps delivering when one listener throws", () => {
    const channel = unique();
    const got: number[] = [];
    const offBad = subscribe(channel, () => {
      throw new Error("closed stream");
    });
    const offGood = subscribe(channel, () => got.push(1));
    expect(() => emit(channel, "move", {})).not.toThrow();
    expect(got).toEqual([1]);
    offBad();
    offGood();
  });

  it("counts distinct members and announces changes", () => {
    const channel = unique();
    const counts: number[] = [];
    const off = subscribe(channel, (event, data) => {
      if (event === "realtime:members") {
        counts.push((data as { count: number }).count);
      }
    });
    const leaveA1 = join(channel, "a");
    const leaveA2 = join(channel, "a"); // a second tab: same member
    const leaveB = join(channel, "b");
    expect(memberCount(channel)).toBe(2);
    leaveA1();
    expect(memberCount(channel)).toBe(2);
    leaveA2();
    leaveB();
    expect(memberCount(channel)).toBe(0);
    expect(counts).toEqual([1, 2, 1, 0]);
    off();
  });

  it("makes leaving idempotent", () => {
    const channel = unique();
    const leave = join(channel, "a");
    leave();
    leave();
    expect(memberCount(channel)).toBe(0);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test tests/unit/realtime/local-bus.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `src/server/realtime/local-bus.ts`**

```ts
import { EVENTS } from "~/match";

export type RealtimePublisher = {
  publish(channel: string, event: string, data: unknown): Promise<void>;
};

type Listener = (event: string, data: unknown) => void;

type Bus = {
  listeners: Map<string, Set<Listener>>;
  /** channel → userId → open connections, so a second tab is one member. */
  members: Map<string, Map<string, number>>;
};

// On globalThis, like the database pool, so `next dev`'s module reloading
// cannot split publishers and subscribers onto two different buses.
const holder = globalThis as unknown as { realtimeBus?: Bus };
const bus: Bus = (holder.realtimeBus ??= {
  listeners: new Map(),
  members: new Map(),
});

/**
 * Spec §8.1's in-process implementation. It reaches only subscribers in this
 * Node process — the SSE stream route — which is why it serves local dev,
 * `next start` and the e2e suite, and why a real deployment uses Pusher.
 */
export function subscribe(channel: string, listener: Listener): () => void {
  let set = bus.listeners.get(channel);
  if (!set) bus.listeners.set(channel, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) bus.listeners.delete(channel);
  };
}

/**
 * Synchronous delivery. A listener that throws — typically a stream whose
 * browser has gone — must not stop the others, nor the publisher.
 */
export function emit(channel: string, event: string, data: unknown): void {
  for (const listener of [...(bus.listeners.get(channel) ?? [])]) {
    try {
      listener(event, data);
    } catch {
      // The stream route unsubscribes on abort; until then, skip it.
    }
  }
}

export function memberCount(channel: string): number {
  return bus.members.get(channel)?.size ?? 0;
}

/** Presence: counts distinct users, and announces every change in count. */
export function join(channel: string, userId: string): () => void {
  let users = bus.members.get(channel);
  if (!users) bus.members.set(channel, (users = new Map()));
  const before = users.size;
  users.set(userId, (users.get(userId) ?? 0) + 1);
  if (users.size !== before) announce(channel);

  let left = false;
  return () => {
    if (left) return;
    left = true;
    const current = bus.members.get(channel);
    if (!current) return;
    const open = (current.get(userId) ?? 1) - 1;
    if (open > 0) {
      current.set(userId, open);
      return;
    }
    current.delete(userId);
    if (current.size === 0) bus.members.delete(channel);
    announce(channel);
  };
}

function announce(channel: string) {
  emit(channel, EVENTS.members, { count: memberCount(channel) });
}

export const localPublisher: RealtimePublisher = {
  async publish(channel, event, data) {
    emit(channel, event, data);
  },
};
```

- [ ] **Step 5: Write `src/server/realtime/index.ts`**

```ts
import "server-only";

import Pusher from "pusher";

import { env } from "~/env";

import { localPublisher, type RealtimePublisher } from "./local-bus";

export type { RealtimePublisher } from "./local-bus";

export const pusherConfigured = Boolean(
  env.PUSHER_APP_ID && env.PUSHER_KEY && env.PUSHER_SECRET && env.PUSHER_CLUSTER,
);

const pusher = pusherConfigured
  ? new Pusher({
      appId: env.PUSHER_APP_ID!,
      key: env.PUSHER_KEY!,
      secret: env.PUSHER_SECRET!,
      cluster: env.PUSHER_CLUSTER!,
      useTLS: true,
    })
  : null;

if (!pusher && process.env.VERCEL) {
  console.warn(
    "[realtime] No Pusher keys: live updates are off on this deployment; clients fall back to polling.",
  );
}

let active: RealtimePublisher = pusher
  ? {
      async publish(channel, event, data) {
        await pusher.trigger(channel, event, data);
      },
    }
  : localPublisher;

export function getPusher(): Pusher | null {
  return pusher;
}

/**
 * Spec §8: publishing never fails a move. Callers publish after their
 * transaction commits; an error here is logged and swallowed, and a watcher
 * who missed the event recovers it from the move log.
 */
export async function publishSafely(
  channel: string,
  event: string,
  data: unknown,
): Promise<void> {
  try {
    await active.publish(channel, event, data);
  } catch (error) {
    console.error(`[realtime] publishing ${event} on ${channel} failed`, error);
  }
}

/** Integration tests only: capture or break publishing. Returns a restore. */
export function swapPublisherForTests(next: RealtimePublisher): () => void {
  const previous = active;
  active = next;
  return () => {
    active = previous;
  };
}
```

- [ ] **Step 6: Write `src/server/realtime/events.ts`**

```ts
import { EVENTS, matchChannel, runChannel } from "~/match";
import type { LoggedMove } from "~/maze";

import { publishSafely } from "./index";

/** One newly committed move, exactly as stored (spec §8). */
export function publishMove(
  matchId: string,
  runnerId: string,
  move: LoggedMove,
): Promise<void> {
  return publishSafely(runChannel(matchId, runnerId), EVENTS.move, move);
}

/** "Refetch the match": no payload, so the channel can disclose nothing. */
export function publishMatchChanged(matchId: string): Promise<void> {
  return publishSafely(matchChannel(matchId), EVENTS.changed, {});
}
```

- [ ] **Step 7: Write the integration test for `publishSafely`**

`tests/integration/realtime-publisher.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { publishSafely, swapPublisherForTests } from "~/server/realtime";

describe("publishSafely", () => {
  it("swallows a publisher error", async () => {
    const restore = swapPublisherForTests({
      async publish() {
        throw new Error("pusher is down");
      },
    });
    try {
      await expect(publishSafely("c", "e", {})).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });

  it("hands the event to the active publisher, and restores the previous one", async () => {
    const seen: unknown[] = [];
    const restore = swapPublisherForTests({
      async publish(channel, event, data) {
        seen.push({ channel, event, data });
      },
    });
    await publishSafely("c", "e", { n: 1 });
    restore();
    await publishSafely("c", "e", { n: 2 });
    expect(seen).toEqual([{ channel: "c", event: "e", data: { n: 1 } }]);
  });
});
```

The error test logs one expected `console.error` line. Silence it with `vi.spyOn(console, "error").mockImplementation(() => {})` inside that test, and assert it was called once, so the test output stays clean.

- [ ] **Step 8: Run the tests**

Run: `pnpm test tests/unit/realtime/local-bus.test.ts && pnpm test:integration tests/integration/realtime-publisher.test.ts`
Expected: PASS, 4 and 2 tests.

- [ ] **Step 9: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/server/realtime src/env.js package.json pnpm-lock.yaml tests/unit/realtime tests/integration/realtime-publisher.test.ts
git commit -m "feat: add the realtime publisher, with Pusher and an in-process bus"
```

---

## Task 4: Publish from the match and the run

**Files:**
- Modify: `src/server/api/routers/run.ts`, `src/server/api/routers/match.ts`, `src/server/match/sweep.ts`
- Create: `tests/integration/realtime-publish.test.ts`

**Interfaces:**
- Consumes: `publishMove`, `publishMatchChanged` (Task 3); `swapPublisherForTests`; `runChannel`, `matchChannel`, `EVENTS` from `~/match`.
- Produces:
  - `match.get` gains `channels: { match: string; yourRun: string; opponentRun: string | null }`
  - Events: `run.move` publishes `move` `{ seq, delta }` on the runner's run channel for every **new** move (not a replayed seq), and `changed` on the match channel when the move completes the match. `run.giveUp`, `match.join`, `match.submitMaze` and a sweep close each publish `changed`.

**Where the publish goes.** Always *after* `ctx.db.transaction(...)` resolves, never inside it. A publish inside the transaction would announce a move that might still roll back, and it would hold the row lock across a network call. So restructure each procedure to `const result = await ctx.db.transaction(...)`, then publish, then return.

- [ ] **Step 1: Write the failing tests**

`tests/integration/realtime-publish.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EVENTS, matchChannel, runChannel } from "~/match";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { match, move } from "~/server/db/schema";
import { closeIfExpired } from "~/server/match/sweep";
import { swapPublisherForTests } from "~/server/realtime";

import {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  GATED_MAZE_ROUTE,
  gatedMazeDraft,
} from "../fixtures/maze";
import { runningMatch, signedIn } from "./players";

type Event = { channel: string; event: string; data: unknown };
let events: Event[] = [];
let restore: () => void = () => {};

beforeEach(() => {
  events = [];
  restore = swapPublisherForTests({
    async publish(channel, event, data) {
      events.push({ channel, event, data });
    },
  });
});
afterEach(() => restore());

const on = (channel: string) => events.filter((e) => e.channel === channel);

describe("publishing", () => {
  it("publishes each new move on the runner's channel", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const result = await host.run.move({ matchId, seq: 1, dir: "S" });
    expect(on(runChannel(matchId, hostId))).toEqual([
      {
        channel: runChannel(matchId, hostId),
        event: EVENTS.move,
        data: { seq: 1, delta: result.delta },
      },
    ]);
  });

  it("publishes nothing for a retried seq", async () => {
    const { host, hostId, matchId } = await runningMatch();
    await host.run.move({ matchId, seq: 1, dir: "S" });
    events = [];
    await host.run.move({ matchId, seq: 1, dir: "S" });
    expect(on(runChannel(matchId, hostId))).toEqual([]);
  });

  it("pings the match when a move completes it", async () => {
    const { host, guest, matchId } = await runningMatch();
    for (const [i, dir] of GATED_MAZE_ROUTE.entries()) {
      await host.run.move({ matchId, seq: i + 1, dir });
    }
    expect(on(matchChannel(matchId))).toEqual([]);
    for (const [i, dir] of GATED_MAZE_ROUTE.entries()) {
      await guest.run.move({ matchId, seq: i + 1, dir });
    }
    expect(on(matchChannel(matchId))).toEqual([
      { channel: matchChannel(matchId), event: EVENTS.changed, data: {} },
    ]);
  });

  it("pings the match on a give-up", async () => {
    const { guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    expect(on(matchChannel(matchId))).toHaveLength(1);
  });

  it("pings the match on join and on each submission", async () => {
    const host = createCaller(await signedIn());
    const guest = createCaller(await signedIn());
    const settings = {
      cellCount: GATED_MAZE_CELL_COUNT,
      gateCount: GATED_MAZE_GATE_COUNT,
    } as const;
    const created = await host.match.create(settings);
    await guest.match.join({ code: created.code });
    expect(on(matchChannel(created.id))).toHaveLength(1);

    const draft = await host.maze.createDraft({ name: "M", ...settings });
    await host.maze.saveDraft({ id: draft.id, data: gatedMazeDraft() });
    await host.match.submitMaze({ matchId: created.id, mazeId: draft.id });
    expect(on(matchChannel(created.id))).toHaveLength(2);
  });

  it("pings the match when the sweep closes it", async () => {
    const { host, matchId } = await runningMatch();
    await host.run.move({ matchId, seq: 1, dir: "S" });
    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    events = [];
    expect(
      await closeIfExpired(db, matchId, new Date(row!.deadlineAt.getTime() + 1)),
    ).toBe(true);
    expect(on(matchChannel(matchId))).toHaveLength(1);
  });

  it("a publisher that throws does not fail the move", async () => {
    restore();
    restore = swapPublisherForTests({
      async publish() {
        throw new Error("pusher is down");
      },
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, hostId, matchId } = await runningMatch();
    const result = await host.run.move({ matchId, seq: 1, dir: "S" });
    expect(result.delta.outcome).toBe("moved");
    const rows = await db.select().from(move).where(eq(move.matchId, matchId));
    expect(rows.filter((r) => r.runnerId === hostId)).toHaveLength(1);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe("match.get channels", () => {
  it("names the match channel and both run channels", async () => {
    const { host, hostId, guestId, matchId } = await runningMatch();
    const got = await host.match.get({ id: matchId });
    expect(got.channels).toEqual({
      match: matchChannel(matchId),
      yourRun: runChannel(matchId, hostId),
      opponentRun: runChannel(matchId, guestId),
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:integration tests/integration/realtime-publish.test.ts`
Expected: FAIL. No events are captured, and `channels` is undefined.

- [ ] **Step 3: Publish from `run.move` and `run.giveUp`**

In `src/server/api/routers/run.ts`, import `publishMatchChanged` and `publishMove` from `~/server/realtime/events`.

In `move`, change `return ctx.db.transaction(async (tx) => { … })` to `const outcome = await ctx.db.transaction(async (tx) => { … })`. Inside the transaction:
- The stored-seq early return becomes `return { delta: stored.delta, matchOver: isTerminal(row.status), fresh: false as const };`.
- The final return becomes `return { delta, matchOver: completion.kind === "complete", fresh: true as const };`.

Then, after the transaction:

```ts
      // After commit (spec §8): a publish inside the transaction could
      // announce a move that rolls back, and would hold the row lock across
      // a network call. A replayed seq was announced the first time.
      if (outcome.fresh) {
        await publishMove(input.matchId, me, {
          seq: input.seq,
          delta: outcome.delta,
        });
        if (outcome.matchOver) await publishMatchChanged(input.matchId);
      }
      return { delta: outcome.delta, matchOver: outcome.matchOver };
```

In `giveUp`, similarly store the transaction's result, then `await publishMatchChanged(input.matchId);` before returning it.

- [ ] **Step 4: Publish from `match.join` and `match.submitMaze`, and add `channels` to `match.get`**

In `src/server/api/routers/match.ts`, import `matchChannel` and `runChannel` from `~/match`, and `publishMatchChanged` from `~/server/realtime/events`. In `join` and `submitMaze`, store the transaction's result, `await publishMatchChanged(<the match id>)`, then return it. In `get`, add to the returned object:

```ts
        // Names only; the server decides who may join (canSubscribe).
        channels: {
          match: matchChannel(row.id),
          yourRun: runChannel(row.id, you.userId),
          opponentRun: them ? runChannel(row.id, them.userId) : null,
        },
```

- [ ] **Step 5: Publish from the sweep**

In `src/server/match/sweep.ts`, `closeIfExpired` returns the transaction's boolean. Store it as `closed`; if it is true, `await publishMatchChanged(matchId);`; then return it. Import from `~/server/realtime/events`.

- [ ] **Step 6: Run the tests**

Run: `pnpm test:integration tests/integration/realtime-publish.test.ts`
Expected: PASS, 8 tests. Then run the full `pnpm test:integration`. Every Phase 3 and 4 test still passes, because the default publisher in tests is the local bus with no subscribers.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add src/server tests/integration/realtime-publish.test.ts
git commit -m "feat: publish moves and match changes after each commit"
```

---

## Task 5: Who may listen, and `run.replay`

**Files:**
- Create: `src/server/realtime/access.ts`, `tests/integration/run-replay.test.ts`
- Modify: `src/server/api/routers/run.ts`, `src/server/api/routers/AGENTS.md`, `messages/en.json`, `messages/sk.json`

**Interfaces:**
- Consumes: `participantRows`, `notYours`, `DbClient` from `~/server/match/access`; `WatchFacts`, `maySubscribe`, `mayWatchOpponent`, `mayReplayOwn`, `parseChannel`, `runChannel`, `isTerminal` from `~/match`; `LoggedMove`, `mazeSchema`, `Maze` from `~/maze`; `MatchRow`, `PlayerRow` from `~/server/match/situation`.
- Produces:
  - `watchFactsFor(row: MatchRow, players: readonly PlayerRow[], userId: string): WatchFacts`
  - `canSubscribe(db: DbClient, userId: string, channelName: string): Promise<boolean>`
  - `run.replay({ matchId, whose: "opponent" | "mine" }) → { maze: Maze; moves: LoggedMove[]; live: boolean; channel: string | null; runnerName: string }`. `maze` is the maze walked, in absolute coordinates. `moves` are in seq order. `channel` is the runner's run channel while `live`.
  - Error keys `errors.watchNotYet`, `errors.replayNotReady`

- [ ] **Step 1: Write the failing tests**

`tests/integration/run-replay.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { runChannel, matchChannel } from "~/match";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { canSubscribe } from "~/server/realtime/access";

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

describe("run.replay", () => {
  it("refuses to show the opponent's run before your own is over", async () => {
    const { host, matchId } = await runningMatch();
    expect(
      await rejection(host.run.replay({ matchId, whose: "opponent" })),
    ).toEqual({ code: "CONFLICT", message: "errors.watchNotYet" });
  });

  it("shows the opponent's run through your maze, live, once you finish", async () => {
    const { host, guest, guestId, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    await walk(guest, matchId, ["S", "S"]);

    const replay = await host.run.replay({ matchId, whose: "opponent" });

    expect(replay.live).toBe(true);
    expect(replay.channel).toBe(runChannel(matchId, guestId));
    expect(replay.moves.map((m) => m.seq)).toEqual([1, 2]);
    expect(replay.moves[1]!.delta.at).toEqual({ x: 0, y: 2 });
    // The host's own maze: the gated seed they submitted.
    expect(replay.maze.cells).toHaveLength(gatedMazeDraft().cells.length);
    expect(replay.runnerName).toBe("Test Person");
  });

  it("stops being live once the runner finishes", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    await walk(guest, matchId, GATED_MAZE_ROUTE);
    const replay = await host.run.replay({ matchId, whose: "opponent" });
    expect(replay).toMatchObject({ live: false, channel: null });
    expect(replay.moves).toHaveLength(GATED_MAZE_ROUTE.length);
  });

  it("refuses your own run until the match is over, then allows it", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    expect(await rejection(host.run.replay({ matchId, whose: "mine" }))).toEqual(
      { code: "CONFLICT", message: "errors.replayNotReady" },
    );
    await guest.run.giveUp({ matchId });
    const mine = await host.run.replay({ matchId, whose: "mine" });
    expect(mine.live).toBe(false);
    expect(mine.moves).toHaveLength(GATED_MAZE_ROUTE.length);
  });

  it("refuses someone not in the match", async () => {
    const { guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    const stranger = createCaller(await signedIn());
    expect(
      await rejection(stranger.run.replay({ matchId, whose: "opponent" })),
    ).toEqual({ code: "FORBIDDEN", message: "errors.notYourMatch" });
  });
});

describe("canSubscribe", () => {
  it("applies the watching gate to run channels", async () => {
    const { host, hostId, guestId, matchId } = await runningMatch();
    expect(await canSubscribe(db, hostId, runChannel(matchId, hostId))).toBe(
      true,
    );
    expect(await canSubscribe(db, hostId, runChannel(matchId, guestId))).toBe(
      false,
    );
    await walk(host, matchId, GATED_MAZE_ROUTE);
    expect(await canSubscribe(db, hostId, runChannel(matchId, guestId))).toBe(
      true,
    );
  });

  it("admits both players, and only them, to the match channel", async () => {
    const { hostId, guestId, matchId } = await runningMatch();
    const strangerCtx = await signedIn();
    expect(await canSubscribe(db, hostId, matchChannel(matchId))).toBe(true);
    expect(await canSubscribe(db, guestId, matchChannel(matchId))).toBe(true);
    expect(
      await canSubscribe(
        db,
        strangerCtx.session!.user.id,
        matchChannel(matchId),
      ),
    ).toBe(false);
  });

  it("refuses a malformed or unknown channel", async () => {
    const { hostId } = await runningMatch();
    expect(await canSubscribe(db, hostId, "presence-run_nope")).toBe(false);
    expect(
      await canSubscribe(db, hostId, matchChannel(crypto.randomUUID())),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:integration tests/integration/run-replay.test.ts`
Expected: FAIL. `~/server/realtime/access` cannot be resolved.

- [ ] **Step 3: Write `src/server/realtime/access.ts`**

```ts
import {
  maySubscribe,
  parseChannel,
  type WatchFacts,
} from "~/match";
import { participantRows, type DbClient } from "~/server/match/access";
import type { MatchRow, PlayerRow } from "~/server/match/situation";

export function watchFactsFor(
  row: MatchRow,
  players: readonly PlayerRow[],
  userId: string,
): WatchFacts {
  const you = players.find((p) => p.userId === userId)!;
  const them = players.find((p) => p.userId !== userId);
  return {
    status: row.status,
    you: {
      userId: you.userId,
      submittedAt: you.submittedAt,
      finishedAt: you.finishedAt,
    },
    opponent: them
      ? { userId: them.userId, submittedAt: them.submittedAt }
      : null,
  };
}

/**
 * Spec §8.1: the only place a subscription is decided. The Pusher auth
 * endpoint and the local stream both call this, so the two transports
 * cannot disagree about who may listen.
 */
export async function canSubscribe(
  db: DbClient,
  userId: string,
  channelName: string,
): Promise<boolean> {
  const channel = parseChannel(channelName);
  if (!channel) return false;
  const found = await participantRows(db, channel.matchId, userId);
  if (!found) return false;
  return maySubscribe(
    channel,
    watchFactsFor(found.row, found.players, userId),
  );
}
```

- [ ] **Step 4: Add `run.replay`**

In `src/server/api/routers/run.ts`, add the imports (`mayReplayOwn`, `mayWatchOpponent`, `runChannel` from `~/match`; `type LoggedMove` from `~/maze`; `watchFactsFor` from `~/server/realtime/access`), then:

```ts
  /**
   * Spec §8: the watch and replay page's one read. The third sanctioned
   * reader of `maze.data` (routers/AGENTS.md): for "opponent" it is your
   * own maze, and for "mine" the opponent's, only once the match is over.
   */
  replay: protectedProcedure
    .input(
      z.object({ matchId: z.string(), whose: z.enum(["opponent", "mine"]) }),
    )
    .query(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      const found = await participantRows(ctx.db, input.matchId, me);
      if (!found) notYours();
      const { row, players } = found;

      const facts = watchFactsFor(row, players, me);
      if (input.whose === "opponent" && !mayWatchOpponent(facts)) {
        refuse("errors.watchNotYet");
      }
      if (input.whose === "mine" && !mayReplayOwn(facts)) {
        refuse("errors.replayNotReady");
      }

      const you = players.find((p) => p.userId === me)!;
      const them = players.find((p) => p.userId !== me)!;
      // §6: a runner walks the *other* player's maze.
      const runner = input.whose === "opponent" ? them : you;
      const author = input.whose === "opponent" ? you : them;

      const [mazeRow] = await ctx.db
        .select({ data: maze.data })
        .from(maze)
        .where(eq(maze.id, author.mazeId!));
      const log = await ctx.db
        .select({ seq: move.seq, delta: move.delta })
        .from(move)
        .where(and(eq(move.matchId, row.id), eq(move.runnerId, runner.userId)))
        .orderBy(asc(move.seq));
      const [named] = await ctx.db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, runner.userId));

      const live =
        !isTerminal(row.status) &&
        runner.finishedAt === null &&
        runner.gaveUpAt === null;

      return {
        maze: mazeSchema.parse(mazeRow!.data),
        moves: log as LoggedMove[],
        live,
        channel: live ? runChannel(row.id, runner.userId) : null,
        runnerName: named?.name ?? "",
      };
    }),
```

- [ ] **Step 5: Document the third reader, and add the copy**

In `src/server/api/routers/AGENTS.md`, change the heading "The two sanctioned readers" to "The sanctioned readers", and add a paragraph: "`run.replay` returns one maze: for `whose: "opponent"` the caller's own maze, which they drew, and for `whose: "mine"` the opponent's, only once the match is terminal and both submitted — the result screen's rule. Its gates are `mayWatchOpponent` and `mayReplayOwn` in `src/match/watch.ts`."

`messages/en.json`, under `errors`:

```json
"watchNotYet": "Finish your own run first.",
"replayNotReady": "Your run can be replayed once the match is over."
```

`messages/sk.json`, under `errors`:

```json
"watchNotYet": "Najprv dokončite svoj vlastný beh.",
"replayNotReady": "Svoj beh si môžete prehrať, keď sa zápas skončí."
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test:integration tests/integration/run-replay.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Break it and watch it fail**

In `run.replay`, swap `them` and `you` in the `runner` line. "shows the opponent's run…" must fail, because the moves would be the host's 11, not the guest's 2. Restore it.

- [ ] **Step 8: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add src/server tests/integration/run-replay.test.ts messages
git commit -m "feat: replay a run, and decide who may listen in one place"
```

---

## Task 6: The realtime routes

**Files:**
- Create: `src/app/api/realtime/stream/route.ts`, `src/app/api/realtime/auth/route.ts`, `tests/integration/realtime-routes.test.ts`
- Modify: `tests/integration/players.ts` (expose each player's cookie)

**Interfaces:**
- Consumes: `canSubscribe`; `subscribe`, `join` from `~/server/realtime/local-bus`; `pusherConfigured`, `getPusher` from `~/server/realtime`; `isPresenceChannel`, `EVENTS` from `~/match`; `getSession` from `~/server/auth`; `db`.
- Produces:
  - `GET /api/realtime/stream?channel=<name>` returns a `text/event-stream`. It sends one SSE event per bus event (`event: <name>\ndata: <json>`), presence events for presence channels, and a `: keep-alive` comment every 25s. It answers 401 without a session, 403 when `canSubscribe` refuses, and 404 when Pusher is configured.
  - `POST /api/realtime/auth` (form `socket_id`, `channel_name`) returns Pusher's auth JSON, with presence data `{ user_id }` on presence channels. It answers 404 when Pusher is not configured, 401 without a session, and 403 when refused.
  - `tests/integration/players.ts`: `signedIn()` also returns its `cookie`, and `runningMatch()` gains `hostCookie` and `guestCookie`.

- [ ] **Step 1: Expose the cookies in the test helpers**

In `tests/integration/players.ts`, make `signedIn` build the context exactly as now, but return `Object.assign(ctx, { cookie })`, so existing callers keep working. In `runningMatch`, return `hostCookie: hostCtx.cookie` and `guestCookie: guestCtx.cookie` alongside the existing fields.

- [ ] **Step 2: Write the failing tests**

`tests/integration/realtime-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { EVENTS, runChannel } from "~/match";
import { POST as auth } from "~/app/api/realtime/auth/route";
import { GET as stream } from "~/app/api/realtime/stream/route";
import { emit, memberCount } from "~/server/realtime/local-bus";

import { runningMatch } from "./players";

function streamRequest(channel: string, cookie?: string, signal?: AbortSignal) {
  return new Request(
    `http://localhost/api/realtime/stream?channel=${encodeURIComponent(channel)}`,
    { headers: cookie ? { cookie } : {}, signal },
  );
}

/** Reads the stream until `predicate` matches the text so far, or 5s pass. */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  predicate: (text: string) => boolean,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 5000;
  while (!predicate(text) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  reader.releaseLock();
  return text;
}

describe("GET /api/realtime/stream", () => {
  it("refuses an anonymous request", async () => {
    const { hostId, matchId } = await runningMatch();
    const res = await stream(streamRequest(runChannel(matchId, hostId)));
    expect(res.status).toBe(401);
  });

  it("refuses the opponent's run before your own is over", async () => {
    const { guestId, hostCookie, matchId } = await runningMatch();
    const res = await stream(
      streamRequest(runChannel(matchId, guestId), hostCookie),
    );
    expect(res.status).toBe(403);
  });

  it("streams events published on the channel, and presence", async () => {
    const { hostId, hostCookie, matchId } = await runningMatch();
    const channel = runChannel(matchId, hostId);
    const abort = new AbortController();
    const res = await stream(streamRequest(channel, hostCookie, abort.signal));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const first = await readUntil(res.body!, (t) => t.includes(EVENTS.members));
    expect(first).toContain(`event: ${EVENTS.members}`);
    expect(first).toContain('"count":1');

    emit(channel, EVENTS.move, { seq: 1 });
    const next = await readUntil(res.body!, (t) => t.includes("event: move"));
    expect(next).toContain('data: {"seq":1}');

    abort.abort();
  });

  it("leaving drops the member count", async () => {
    const { hostId, hostCookie, matchId } = await runningMatch();
    const channel = runChannel(matchId, hostId);
    const abort = new AbortController();
    const res = await stream(streamRequest(channel, hostCookie, abort.signal));
    await readUntil(res.body!, (t) => t.includes(EVENTS.members));
    expect(memberCount(channel)).toBe(1);
    abort.abort();
    // The abort listener runs on the next tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(memberCount(channel)).toBe(0);
  });
});

describe("POST /api/realtime/auth", () => {
  it("does not exist without Pusher keys", async () => {
    const { hostId, hostCookie, matchId } = await runningMatch();
    const body = new URLSearchParams({
      socket_id: "1.1",
      channel_name: runChannel(matchId, hostId),
    });
    const res = await auth(
      new Request("http://localhost/api/realtime/auth", {
        method: "POST",
        headers: {
          cookie: hostCookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      }),
    );
    expect(res.status).toBe(404);
  });
});
```

The last test assumes the test environment has no `PUSHER_*` variables, which is true of `.env` and of CI. Say so in a comment.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm test:integration tests/integration/realtime-routes.test.ts`
Expected: FAIL, the route modules cannot be resolved.

- [ ] **Step 4: Write `src/app/api/realtime/stream/route.ts`**

```ts
import { isPresenceChannel } from "~/match";
import { getSession } from "~/server/auth";
import { db } from "~/server/db";
import { pusherConfigured } from "~/server/realtime";
import { canSubscribe } from "~/server/realtime/access";
import { join, subscribe } from "~/server/realtime/local-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEEP_ALIVE_MS = 25_000;

/**
 * Spec §8.1: the local transport. Streams the in-process bus to one browser
 * as server-sent events, and holds its presence while the connection is
 * open. With Pusher configured this route does not exist — two live
 * transports would be two places for a subscription rule to drift.
 */
export async function GET(request: Request) {
  if (pusherConfigured) return new Response("Not found", { status: 404 });

  const session = await getSession(request.headers);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const channel = new URL(request.url).searchParams.get("channel") ?? "";
  if (!(await canSubscribe(db, session.user.id, channel))) {
    return new Response("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();
  let stop = () => {};

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));
      const off = subscribe(channel, (event, data) => {
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      });
      // After subscribing, so this connection hears its own arrival.
      const leave = isPresenceChannel(channel)
        ? join(channel, session.user.id)
        : () => {};
      const keepAlive = setInterval(() => write(": keep-alive\n\n"), KEEP_ALIVE_MS);

      let stopped = false;
      stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(keepAlive);
        off();
        leave();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };
      request.signal.addEventListener("abort", () => stop());
    },
    cancel() {
      stop();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 5: Write `src/app/api/realtime/auth/route.ts`**

```ts
import { isPresenceChannel } from "~/match";
import { getSession } from "~/server/auth";
import { db } from "~/server/db";
import { getPusher } from "~/server/realtime";
import { canSubscribe } from "~/server/realtime/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pusher's channel authorisation (spec §8.1). Same rule as the local stream:
 * `canSubscribe`. Presence channels carry the user id and nothing else.
 */
export async function POST(request: Request) {
  const pusher = getPusher();
  if (!pusher) return new Response("Not found", { status: 404 });

  const session = await getSession(request.headers);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  const socketId = String(form.get("socket_id") ?? "");
  const channel = String(form.get("channel_name") ?? "");
  if (!(await canSubscribe(db, session.user.id, channel))) {
    return new Response("Forbidden", { status: 403 });
  }

  const response = isPresenceChannel(channel)
    ? pusher.authorizeChannel(socketId, channel, { user_id: session.user.id })
    : pusher.authorizeChannel(socketId, channel);
  return Response.json(response);
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test:integration tests/integration/realtime-routes.test.ts`
Expected: PASS, 5 tests. If the route modules cannot be imported under Vitest (`server-only`, the `next/*` imports pulled in through `~/server/auth`), say so and report it as BLOCKED with the error. Do not mock the auth module away. `~/server/auth` already loads in the integration suite through `createTRPCContext`, so it should work.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/app/api/realtime tests/integration
git commit -m "feat: stream realtime events locally, and authorise Pusher channels"
```

---

## Task 7: Live updates in the client

**Files:**
- Create: `src/components/realtime/use-channel.ts`
- Modify: `src/components/match/match-screen.tsx`, `src/components/run/run-view.tsx`, `messages/en.json`, `messages/sk.json`, `package.json` (`pusher-js`)

**Interfaces:**
- Consumes: `match.get`'s `channels`; `EVENTS` from `~/match`; `env` from `~/env` (client vars); the routes from Task 6.
- Produces:
  - `useChannel(channel: string | null, handlers: { onEvent?: (event: string, data: unknown) => void; onMembers?: (count: number) => void; onReconnect?: () => void }): void`
  - DOM hooks: `[data-watchers="N"]` (rendered only when N ≥ 1), and the waiting state's `a[data-watch-live]` link to `/matches/{id}/watch?run=opponent`

- [ ] **Step 1: Add `pusher-js` and the copy**

```bash
pnpm add pusher-js@8
```

`messages/en.json`, under `run`:

```json
"watching": "{count, plural, one {# watching} other {# watching}}",
"watchLive": "Watch them live"
```

`messages/sk.json`, under `run`:

```json
"watching": "{count, plural, one {Sleduje # človek} few {Sledujú # ľudia} other {Sleduje # ľudí}}",
"watchLive": "Sledovať súpera naživo"
```

- [ ] **Step 2: Write `src/components/realtime/use-channel.ts`**

```ts
"use client";

import Pusher, { type PresenceChannel } from "pusher-js";
import { useEffect, useRef } from "react";

import { env } from "~/env";
import { EVENTS } from "~/match";

type Handlers = {
  onEvent?: (event: string, data: unknown) => void;
  /** Distinct users on a presence channel, including you. */
  onMembers?: (count: number) => void;
  /** The connection came back: anything published meanwhile was missed. */
  onReconnect?: () => void;
};

let pusher: Pusher | null = null;

function pusherClient(): Pusher | null {
  if (!env.NEXT_PUBLIC_PUSHER_KEY || !env.NEXT_PUBLIC_PUSHER_CLUSTER) {
    return null;
  }
  return (pusher ??= new Pusher(env.NEXT_PUBLIC_PUSHER_KEY, {
    cluster: env.NEXT_PUBLIC_PUSHER_CLUSTER,
    channelAuthorization: {
      endpoint: "/api/realtime/auth",
      transport: "ajax",
    },
  }));
}

/**
 * One realtime subscription, over Pusher when it is configured and the local
 * event stream otherwise (spec §8.1). Handlers are read through a ref, so
 * they may change every render without resubscribing.
 *
 * Subscribing to the same channel from two components on one page is not
 * supported: with Pusher, the first to unmount unsubscribes both. No page
 * does it.
 */
export function useChannel(channel: string | null, handlers: Handlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!channel) return;

    const client = pusherClient();
    if (client) {
      const sub = client.subscribe(channel);
      const relay = (event: string, data: unknown) => {
        if (!event.startsWith("pusher:")) latest.current.onEvent?.(event, data);
      };
      sub.bind_global(relay);
      const members = () =>
        latest.current.onMembers?.((sub as PresenceChannel).members.count);
      if (channel.startsWith("presence-")) {
        sub.bind("pusher:subscription_succeeded", members);
        sub.bind("pusher:member_added", members);
        sub.bind("pusher:member_removed", members);
      }
      // The first "connected" is the initial connection; every later one is
      // a reconnect, after which the caller must catch up from the server.
      let connectedOnce = client.connection.state === "connected";
      const onState = ({ current }: { current: string }) => {
        if (current !== "connected") return;
        if (connectedOnce) latest.current.onReconnect?.();
        connectedOnce = true;
      };
      client.connection.bind("state_change", onState);
      return () => {
        sub.unbind_global(relay);
        client.connection.unbind("state_change", onState);
        client.unsubscribe(channel);
      };
    }

    const source = new EventSource(
      `/api/realtime/stream?channel=${encodeURIComponent(channel)}`,
    );
    let opened = false;
    source.onopen = () => {
      // EventSource reconnects by itself; every open after the first is a
      // reconnect, and the caller must catch up from the server.
      if (opened) latest.current.onReconnect?.();
      opened = true;
    };
    const forward = (event: string) => (message: MessageEvent<string>) =>
      latest.current.onEvent?.(event, JSON.parse(message.data) as unknown);
    const onMove = forward(EVENTS.move);
    const onChanged = forward(EVENTS.changed);
    const onMembers = (message: MessageEvent<string>) =>
      latest.current.onMembers?.(
        (JSON.parse(message.data) as { count: number }).count,
      );
    source.addEventListener(EVENTS.move, onMove);
    source.addEventListener(EVENTS.changed, onChanged);
    source.addEventListener(EVENTS.members, onMembers);
    return () => source.close();
  }, [channel]);
}
```

- [ ] **Step 3: Wire `MatchScreen`**

In `src/components/match/match-screen.tsx`:
- Change `POLL_MS` to `60_000` and rewrite its comment. It is now only the fallback for a dropped connection, because pings arrive on the match channel (spec §8).
- Poll every non-terminal status, not only `running`: `refetchInterval: (query) => query.state.data && !isTerminal(query.state.data.status) ? POLL_MS : false`.
- Add:

```tsx
  const utils = api.useUtils();
  const refresh = () => {
    void utils.match.get.invalidate({ id: matchId });
    void utils.run.get.invalidate({ matchId });
  };
  useChannel(data.channels.match, {
    onEvent: (event) => {
      if (event === EVENTS.changed) refresh();
    },
    onReconnect: refresh,
  });
```

- Pass `runChannel={data.channels.yourRun}` to `RunView`.

- [ ] **Step 4: Add the badge and the watch link to `RunView`**

In `src/components/run/run-view.tsx`:
- Accept a `runChannel: string` prop.
- `const [members, setMembers] = useState(0);` then `useChannel(runChannel, { onMembers: setMembers });`. The watchers are `Math.max(0, members - 1)`, everyone but you.
- Next to the HUD, when watchers ≥ 1, render `<span data-watchers={watchers} className="text-muted text-sm">{t("watching", { count: watchers })}</span>`. Use the existing token classes.
- In the finished, waiting state, under `[data-run-finished]`, render a `Link` from `~/i18n/navigation` to `` `/matches/${matchId}/watch?run=opponent` `` with `data-watch-live` and the text `t("watchLive")`.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/components package.json pnpm-lock.yaml messages
git commit -m "feat: update the match live, and show the runner who is watching"
```

Task 9's e2e specs prove this task. It has no tests of its own, as with every UI task.

---

## Task 8: The watch and replay page

**Files:**
- Create: `src/components/watch/watch-view.tsx`, `src/app/[locale]/(app)/matches/[id]/watch/page.tsx`
- Modify: `src/components/run/match-result.tsx`, `messages/en.json`, `messages/sk.json`

**Interfaces:**
- Consumes: `run.replay`; `useChannel`; `mergeMoves`, `playable`, `frameAt`, `initialPlayback`, `playback`, `tickMs`, `SPEEDS`, `LoggedMove` from `~/maze`; `EVENTS` from `~/match`; `RunBoard` and `ResultMaze` from `~/components/run/*`.
- Produces:
  - `<WatchView matchId whose />`
  - DOM hooks:
    - `[data-watch-view]` with `data-live="true|false"`, `data-watch-step="N"` and `data-watch-length="N"`
    - `[data-watch-runner-view]`, which wraps the `RunBoard` (whose `[data-runner-at]` is start-relative)
    - `[data-watch-maze-view]`, which wraps the `ResultMaze`
    - an `input[type=range]` labelled `watch.scrubber`
    - play/pause buttons named `watch.play` / `watch.pause`
    - a speed radiogroup labelled `watch.speed`
    - `[data-jump-live]`
    - `[data-watch-error]`
  - Result screen links: `a[data-replay-link="mine"]` and `a[data-replay-link="opponent"]`

- [ ] **Step 1: Add the copy**

`messages/en.json`, a top-level `watch` namespace:

```json
"watch": {
  "opponentTitle": "{name} in your labyrinth",
  "mineTitle": "Your run through {name}'s labyrinth",
  "runnerView": "What the runner has seen",
  "mazeView": "The whole labyrinth",
  "play": "Play",
  "pause": "Pause",
  "scrubber": "Timeline",
  "speed": "Speed",
  "speedOption": "{speed}×",
  "live": "Live",
  "jumpToLive": "Jump to live",
  "step": "Move {step} of {length}",
  "back": "Back to the match"
}
```

`messages/sk.json`:

```json
"watch": {
  "opponentTitle": "Hráč {name} vo vašom bludisku",
  "mineTitle": "Váš beh bludiskom hráča {name}",
  "runnerView": "Čo bežec zatiaľ videl",
  "mazeView": "Celé bludisko",
  "play": "Prehrať",
  "pause": "Pozastaviť",
  "scrubber": "Časová os",
  "speed": "Rýchlosť",
  "speedOption": "{speed}×",
  "live": "Naživo",
  "jumpToLive": "Prejsť na živé vysielanie",
  "step": "Ťah {step} z {length}",
  "back": "Späť na zápas"
}
```

Under `result`, add `"replayMine": "Replay your run"` / `"Prehrať váš beh"` and `"replayTheirs": "Replay {name}'s run"` / `"Prehrať beh hráča {name}"`.

- [ ] **Step 2: Write the page**

`src/app/[locale]/(app)/matches/[id]/watch/page.tsx` is a server component. Await `params` (`{ id }`) and `searchParams` (`{ run?: string }`). `whose` is `"mine"` when `run === "mine"`, and `"opponent"` otherwise. As in `matches/[id]/page.tsx`, call `api.match.get({ id }).catch(() => null)` and `notFound()` on null, so an outsider gets the same 404 as for a match that does not exist. Render `<main className="mx-auto max-w-5xl space-y-6 p-8">` containing `<WatchView matchId={id} whose={whose} />`.

- [ ] **Step 3: Write `src/components/watch/watch-view.tsx`**

A client component. Props: `{ matchId: string; whose: "opponent" | "mine" }`.

- **Data.** `api.run.replay.useQuery({ matchId, whose }, { retry: false, refetchOnWindowFocus: false })`. On error, render `<p role="alert" data-watch-error>` with `resolveErrorKey(te, error, "errors.unknown")` translated, plus a `Link` back to `/matches/{id}` (`watch.back`). While pending, render `null`.
- **Moves.** `const [moves, setMoves] = useState<LoggedMove[]>([])`. When `data` arrives (and on every refetch), `setMoves((m) => mergeMoves(m, data.moves))`. `const timeline = useMemo(() => playable(moves), [moves])`.
- **Live.** `const [live, setLive] = useState(false)` is set from `data.live`. Call `useChannel(live ? data.channel : null, { onEvent, onReconnect })`:
  - `onEvent(EVENTS.move, payload)` → `setMoves((m) => mergeMoves(m, [payload as LoggedMove]))`. If `(payload as LoggedMove).delta.finished`, call `setLive(false)`.
  - `onReconnect` → `refetch()`.
- **Playback.** `useReducer(playback, …)`, initialised once the first data arrives with `initialPlayback(playable(data.moves).length, data.live)`. Use a `useEffect` on `[timeline.length, live]` that dispatches `{ type: "arrived", length: timeline.length, live }`. While `state.playing`, a `setInterval(() => dispatch({ type: "tick" }), tickMs(state.speed))`, cleared on change and unmount.
- **Frame.** `const frame = useMemo(() => frameAt(timeline, state.step), [timeline, state.step])`. The bump for the left board is `frame.last` when its outcome starts with `blocked` and it has a `revealedSegment`, as `{ segment, id: frame.moves }`. Otherwise it is null.
- **Layout.** Root: `<div data-watch-view data-live={String(state.live)} data-watch-step={state.step} data-watch-length={state.length} className="space-y-4">`.
  - **Heading:** `watch.opponentTitle` or `watch.mineTitle` with `{ name: data.runnerName }`. A `[data-live]` "Live" pill while `state.live`. A `[data-jump-live]` button (`watch.jumpToLive`) while `state.live && !state.following`.
  - **Boards:** `grid gap-6 md:grid-cols-2`, so the left board stacks first on phones (§10.4).
    - **Left:** `<section data-watch-runner-view aria-label={t("runnerView")}>` with `<RunBoard map={frame.map} at={frame.at} heldKeys={frame.heldKeys} bump={bump} pending={false} />`, plus penalties and moves under it.
    - **Right:** `<section data-watch-maze-view>` with `<ResultMaze maze={data.maze} path={frame.path.map((p) => ({ x: p.x + data.maze.start.x, y: p.y + data.maze.start.y }))} label={t("mazeView")} which={whose === "opponent" ? "yours" : "theirs"} />`. The path is start-relative and the maze is absolute (`RunnerDelta`'s doc comment).
  - **Controls:**
    - a play/pause toggle button (`watch.play` / `watch.pause`)
    - `<input type="range" min={0} max={state.length} value={state.step} aria-label={t("scrubber")} onChange={(e) => dispatch({ type: "scrub", step: Number(e.target.value) })} />`
    - `watch.step` text
    - a speed radiogroup over `SPEEDS`, following `src/components/editor/shape-tools.tsx`'s radiogroup pattern exactly (one tab stop, arrows move and select, `aria-checked`)
  - **Back:** a link to the match (`watch.back`).
- **Keyboard:** Space toggles play/pause when focus is not in an input, and Left/Right step by one (scrub ±1), following `run-view.tsx`'s `isTypingTarget` guard.

- [ ] **Step 4: Add the replay links to the result screen**

In `src/components/run/match-result.tsx`, when `mazes` is non-null, render under the mazes two `Link`s from `~/i18n/navigation`:
- `` `/matches/${matchId}/watch?run=mine` `` with `data-replay-link="mine"` and `t("replayMine")`
- `` `/matches/${matchId}/watch?run=opponent` `` with `data-replay-link="opponent"` and `t("replayTheirs", { name: opponent.displayName })`

Keep the static path summary as it is (§10.3.1).

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/components src/app messages
git commit -m "feat: watch a run live, and replay either run after the match"
```

---

## Task 9: End to end — live and replay

**Files:**
- Create: `e2e/watch.spec.ts`
- Modify: `e2e/support/run.ts` (only if a helper is needed)

**Interfaces:**
- Consumes: `startRunningMatch`, `walk` from `e2e/support/run.ts`; `players`, `createMatch` from `e2e/support/match.ts`; `GATED_MAZE_ROUTE`; every DOM hook in Tasks 7 and 8.

These specs run against the local stream. Playwright's `webServer` is `pnpm build && pnpm start`, a single Node process, which is exactly what the in-process bus needs. A push that arrives proves the realtime path, because the fallback poll is 60s and every timeout below is 10s.

- [ ] **Step 1: Write `e2e/watch.spec.ts`**

```ts
import { expect } from "@playwright/test";

import { GATED_MAZE_ROUTE } from "~/lib/open-maze";

import { createMatch, test } from "./support/match";
import { startRunningMatch, walk } from "./support/run";

// Well under the 60s fallback poll: passing these proves the push.
const PUSH = { timeout: 10_000 };

test.describe("watching and replay", () => {
  test.describe.configure({ timeout: 90_000 });

  test("the author watches the runner live, and the runner sees the badge", async ({
    players,
  }, testInfo) => {
    const { host, guest } = await startRunningMatch(players, createMatch);
    await walk(host, [...GATED_MAZE_ROUTE], testInfo);
    await host.locator("a[data-watch-live]").click();
    await expect(host).toHaveURL(/\/watch\?run=opponent$/);
    const view = host.locator("[data-watch-view]");
    await expect(view).toHaveAttribute("data-live", "true");
    await expect(view).toHaveAttribute("data-watch-step", "0");

    await expect(guest.locator("[data-watchers]")).toHaveAttribute(
      "data-watchers",
      "1",
      PUSH,
    );

    await walk(guest, ["S", "S"], testInfo);
    await expect(view).toHaveAttribute("data-watch-step", "2", PUSH);
    await expect(
      host.locator("[data-watch-runner-view] [data-runner-at]"),
    ).toHaveAttribute("data-runner-at", "0,2");

    // Leaving clears the badge.
    await host.goto("/en/matches");
    await expect(guest.locator("[data-watchers]")).toHaveCount(0, PUSH);
  });

  test("watching is refused before your own run is over", async ({
    players,
  }) => {
    const { guest } = await startRunningMatch(players, createMatch);
    await guest.goto(`${new URL(guest.url()).pathname}/watch?run=opponent`);
    await expect(guest.locator("[data-watch-error]")).toContainText(
      "Finish your own run first.",
    );
  });

  test("the lobby moves to the run the moment the opponent submits", async ({
    players,
  }) => {
    const size = { cellCount: 36, gateCount: 1, layout: "gated" as const };
    const host = await players({ name: "Host maze", ...size });
    const guest = await players({ name: "Guest maze", ...size });
    const code = await createMatch(host, { cells: 36, gates: 1 });
    await guest.goto("/en/matches");
    await guest.getByLabel("Join code").fill(code);
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest).toHaveURL(/\/en\/matches\/[^/]+$/);

    // The host's lobby learns of the join without a reload.
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
      PUSH,
    );
    await host.locator("[data-maze-option]").first().click();
    await host.getByRole("button", { name: "Submit this labyrinth" }).click();
    await host.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(host.locator("[data-you-submitted]")).toHaveAttribute(
      "data-you-submitted",
      "true",
    );

    await guest.locator("[data-maze-option]").first().click();
    await guest.getByRole("button", { name: "Submit this labyrinth" }).click();
    await guest.getByRole("button", { name: "Submit", exact: true }).click();

    await expect(host.locator("[data-run-view]")).toBeVisible(PUSH);
  });

  test("giving up reaches the opponent at once", async ({ players }) => {
    const { host, guest } = await startRunningMatch(players, createMatch);
    await guest.getByRole("button", { name: "Give up" }).click();
    await guest.getByRole("button", { name: "Yes, give up" }).click();
    await expect(host.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "won",
      PUSH,
    );
  });

  test("a finished run replays, scrubs and plays", async ({
    players,
  }, testInfo) => {
    const { host, guest } = await startRunningMatch(players, createMatch);
    await walk(host, [...GATED_MAZE_ROUTE], testInfo);
    await walk(guest, [...GATED_MAZE_ROUTE], testInfo);
    await expect(host.locator("[data-match-result]")).toBeVisible(PUSH);

    await host.locator('a[data-replay-link="mine"]').click();
    const view = host.locator("[data-watch-view]");
    await expect(view).toHaveAttribute("data-live", "false");
    await expect(view).toHaveAttribute("data-watch-length", "11");

    await host.getByLabel("Timeline").fill("3");
    await expect(view).toHaveAttribute("data-watch-step", "3");
    await expect(
      host.locator("[data-watch-runner-view] [data-runner-at]"),
    ).toHaveAttribute("data-runner-at", "0,2");

    await host.getByRole("button", { name: "Play" }).click();
    // 8 moves at four a second.
    await expect(view).toHaveAttribute("data-watch-step", "11", PUSH);
  });
});
```

The lobby spec reads `[data-match-status]` and `[data-you-submitted]` off the Phase 3 lobby. Both still exist while a match is `awaiting_opponent` or `drawing`. Check that before trusting a failure.

- [ ] **Step 2: Check what is serving port 3000**

Run: `lsof -iTCP:3000 -sTCP:LISTEN`. It must be empty, or Playwright will reuse a stale server.

- [ ] **Step 3: Run the suite**

Run: `pnpm e2e`
Expected: every spec passes in both projects, including the 5 new ones. The Phase 4 specs that waited up to 30s on the poll now pass faster.

If a spec fails because the product is wrong, you may fix the product code. Each fix goes in its own `fix:` commit naming the defect, and is listed in the report with the failing assertion. Never weaken an assertion to get a pass.

- [ ] **Step 4: Break it and watch it fail**

In `MatchScreen`, comment out the `useChannel` call. "giving up reaches the opponent at once" and "the lobby moves…" must time out at 10s. Restore it.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check
git add e2e
git commit -m "test: watch live, replay, and receive pushes end to end"
```

---

## Task 10: Nightly Pusher smoke test, and the docs

**Files:**
- Create: `tests/smoke/pusher.test.ts`, `vitest.smoke.config.ts`, `.github/workflows/nightly-pusher.yml`
- Modify: `package.json` (`test:smoke`), `AGENTS.md`, `docs/backlog.md`, `docs/superpowers/specs/2026-09-22-labyrinth-design.md` (§9.2's polling sentence)

- [ ] **Step 1: Write the smoke test**

`vitest.smoke.config.ts`: copy `vitest.integration.config.ts` with `include: ["tests/smoke/**/*.test.ts"]` and `testTimeout: 30_000`. Keep `setupFiles: ["dotenv/config"]`, and drop the database comment. Add `"test:smoke": "vitest run --config vitest.smoke.config.ts"` to `package.json` scripts.

`tests/smoke/pusher.test.ts`:

```ts
import Pusher from "pusher";
import PusherClient from "pusher-js";
import { describe, expect, it } from "vitest";

const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
const configured = Boolean(
  PUSHER_APP_ID && PUSHER_KEY && PUSHER_SECRET && PUSHER_CLUSTER,
);

/**
 * Spec §8.1: the one test against the real service, nightly. It proves the
 * keys work and a server trigger reaches a client — not the app's channel
 * rules, which the local transport's tests cover. A public channel, so no
 * auth endpoint is needed. Skips itself until the keys are configured.
 */
describe.skipIf(!configured)("Pusher", () => {
  it("delivers a server trigger to a subscribed client", async () => {
    const server = new Pusher({
      appId: PUSHER_APP_ID!,
      key: PUSHER_KEY!,
      secret: PUSHER_SECRET!,
      cluster: PUSHER_CLUSTER!,
      useTLS: true,
    });
    const client = new PusherClient(PUSHER_KEY!, { cluster: PUSHER_CLUSTER! });
    const channelName = `smoke-${Date.now()}`;
    try {
      const channel = client.subscribe(channelName);
      await new Promise<void>((resolve, reject) => {
        channel.bind("pusher:subscription_succeeded", () => resolve());
        channel.bind("pusher:subscription_error", reject);
      });
      const received = new Promise<unknown>((resolve) =>
        channel.bind("ping", resolve),
      );
      await server.trigger(channelName, "ping", { at: channelName });
      expect(await received).toEqual({ at: channelName });
    } finally {
      client.disconnect();
    }
  });
});
```

- [ ] **Step 2: Write `.github/workflows/nightly-pusher.yml`**

```yaml
name: Nightly Pusher smoke

on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:

jobs:
  smoke:
    runs-on: ubuntu-latest
    env:
      SKIP_ENV_VALIDATION: "true"
      PUSHER_APP_ID: ${{ secrets.PUSHER_APP_ID }}
      PUSHER_KEY: ${{ secrets.PUSHER_KEY }}
      PUSHER_SECRET: ${{ secrets.PUSHER_SECRET }}
      PUSHER_CLUSTER: ${{ secrets.PUSHER_CLUSTER }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # Skips itself (reported as skipped, not passed) until the four
      # PUSHER_* repository secrets exist.
      - run: pnpm test:smoke
```

Run `pnpm test:smoke` locally. It must report 1 skipped test and exit 0.

- [ ] **Step 3: Update `AGENTS.md`**

Add invariant 12:

```markdown
12. **Every realtime subscription is decided by `canSubscribe`**
    (`src/server/realtime/access.ts`), which applies `maySubscribe`
    (`src/match/watch.ts`). The Pusher auth route and the local stream route
    both call it; a third transport must too. Publishing happens after the
    transaction commits, through `publishSafely`, and never fails the caller.
```

Add a "Realtime" subsection under "Local environment":
- Without `PUSHER_*` variables, the server uses an in-process bus that reaches browsers only through `/api/realtime/stream` on the same Node process. That is fine for `pnpm dev`, `pnpm start` and `pnpm e2e`. On a serverless deployment it reaches nobody, and clients fall back to the 60s poll.
- For production, set `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET` and `PUSHER_CLUSTER`, plus `NEXT_PUBLIC_PUSHER_KEY` and `NEXT_PUBLIC_PUSHER_CLUSTER`, in Vercel. Add the four server ones as GitHub repository secrets for the nightly smoke test.

Add `pnpm test:smoke` to the Commands table.

- [ ] **Step 4: Update the backlog and §9.2**

In `docs/backlog.md`:
- Delete "Live lobby updates" and "Live 'opponent gave up' push" (done in Phase 5). If "Waiting on a later phase" is then empty, delete the heading.
- Add under "Technical":
  - **"Pusher keys are not configured"** (Phase 5): production has no live updates until a Pusher app exists and its six variables are set (AGENTS.md, Realtime).
  - **"`pusher-js` ships to every client"** (Phase 5): even when Pusher is not configured. A dynamic import inside `useChannel` would drop it from the bundle.

In the spec's §9.2, replace "Live push arrives with the realtime layer (§8); until then the poll is the notification." with "Since Phase 5 the match channel's ping delivers it at once (§8); the poll remains as the fallback for a dropped connection."

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm format:check && pnpm test:smoke && pnpm typecheck && pnpm lint
git add tests/smoke vitest.smoke.config.ts .github/workflows/nightly-pusher.yml package.json AGENTS.md docs
git commit -m "test: add the nightly Pusher smoke test, and document the realtime setup"
```

---

## Self-review

**Spec coverage.**
- §8:
  - the watching gate → Tasks 1 and 5
  - the two channels → Tasks 1, 3 and 4
  - "publishing never fails a move" → Tasks 3 and 4
  - fixed-pace replay → Task 2
  - who can replay what → Tasks 1 and 5
  - the badge → Task 7
- §8.1:
  - the publisher abstraction → Task 3
  - the local SSE transport and the single subscription rule → Tasks 5 and 6
  - `useChannel` → Task 7
  - the nightly smoke test → Task 10
- §10.4:
  - the two boards and stacking → Task 8
  - the watch page with live follow and jump to live → Task 8
  - the entry points → Tasks 7 and 8
- §9.2: the instant "opponent gave up" → Task 7, proved in Task 9.
- Backlog: live lobby updates → Task 7, proved in Task 9.
- §12: unit tests in Tasks 1–3, integration tests in Tasks 3–6, e2e in Task 9, the smoke test in Task 10.

**Type consistency.**
- `LoggedMove` is defined in Task 2 and used as the event payload in Tasks 3–4, the replay output in Task 5 and the client state in Task 8.
- `WatchFacts` and `maySubscribe` are defined in Task 1 and used by `canSubscribe` in Task 5.
- `runChannel`, `matchChannel` and `EVENTS` are defined in Task 1 and used in Tasks 3–9.
- `swapPublisherForTests` is defined in Task 3 and used in Task 4.
- `match.get.channels` is defined in Task 4 and used in Task 7.
- The DOM hooks are defined in the Produces blocks of Tasks 7–8 and used in Task 9.

**A caution about counts.** The test counts are my own, counted from the code. Treat a mismatch as a defect in this document.

**A caution about the Pusher client branch.** Only the nightly smoke test touches `pusher-js` against a real server, and it does not go through `useChannel`. The Pusher half of `useChannel` is reviewed by reading, not tested. Keep it as thin as written.
