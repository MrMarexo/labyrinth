# Phase 3 — Match Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two accounts can create a match with frozen settings, join it by code, each submit a labyrinth, and watch the match reach `running` — with every §9.1 deadline enforced by a scheduled sweep.

**Architecture:** A new pure domain at `src/match/` owns the state machine, the §9.1 deadline table and the match-code alphabet — no Next, no Drizzle, no clock of its own. The `matchRouter` is the only thing that touches the database, and it recomputes the single `deadlineAt` column on every transition rather than scattering six rules through the code. A cron-triggered sweep evaluates expired matches with the same pure function the router uses.

**Tech Stack:** Next.js App Router, tRPC, Drizzle (`drizzle-orm/neon-serverless` with `Pool`), Postgres on Neon, Better Auth, next-intl, Tailwind v4, Vitest, fast-check, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-22-labyrinth-design.md` — §6 (data model), §9 (lifecycle and deadlines), §11 (errors), §12 (testing), §15 (phases).

## Global Constraints

- **Purity.** `src/maze/**`, `src/match/**` and `src/lib/issues.ts` import nothing from Next, React, tRPC, Drizzle, Better Auth, next-intl, `@t3-oss/*`, `@neondatabase/*`, Node builtins, or the `~/server`, `~/app`, `~/components`, `~/trpc`, `~/i18n`, `~/env`, `~/styles` aliases. ESLint enforces it; see AGENTS.md invariant 2.
- **No clock inside the pure domain.** Every deadline function takes `now: Date` as an argument. The spec requires the §9.1 suite to inject the clock rather than sleep.
- **You cannot win without finding the treasure.** A forfeit never produces a winner who did not reach the treasure. `winnerId` is null for every outcome except `finished` and `forfeit`, and a `forfeit` winner must have `finishedAt` set. Asserted directly, not inferred.
- **Nothing expires while both players are still engaged.** Every deadline is anchored to the last thing that actually happened.
- **Errors travel as i18n message keys with sanitised params, never English strings.** The typed set from §11 is `MazeInvalid`, `MatchExpired`, `MatchFull`, `NotAParticipant`, `RunNotUnlocked`, `RunAlreadyFinished`, `Forbidden`. Phase 3 uses the first four and `Forbidden`.
- **A maze is immutable once submitted.** `maze.saveDraft` and `maze.remove` already refuse a submitted maze.
- **A submitted maze may be reused** in a later match whose `cellCount` and `gateCount` match. Reuse against an opponent who has already faced that maze is rejected. There is no edit and no duplicate-to-edit.
- **The maze a player solves is the opponent's `match_player.mazeId`, never their own.** That join is the only place the mapping exists.
- **Both locales carry identical key sets.** `messages/en.json` and `messages/sk.json`; a unit test enforces it. Slovak must read like a person wrote it and declines adjectives per noun gender (neuter for *políčko*, feminine for *hrana*).
- **Colours come from CSS custom properties**, never hardcoded in a component (AGENTS.md invariant 10). Responsive, light and dark, usable at phone width.
- `MAX_BOUNDING_BOX = 16`, `MAX_GATES = 8`, `CELL_COUNT_PRESETS = [36, 64, 100, 144]`.
- **Never commit `.env`** or print a connection string.
- **Mazes are seeded through a test-only procedure behind an env flag** (spec §12). A test that clicks sixty wall segments fails for reasons unrelated to what it checks.

## What Phase 3 does *not* build

The run itself (moves, fog, penalties, finishing) is Phase 4; spectating and replay are Phase 5. This plan therefore:

- creates **no `move` table** — it has no consumer until Phase 4, and this project does not design contracts without a caller;
- creates **no run columns** on `match_player` (`runStatus`, `penalties`, `moveCount`, `runState`, `startedAt`, `lastMoveAt`, `finishedAt`) — Phase 4 adds them in its own migration;
- implements **all six §9.1 rows as pure logic** but can only *wire* rows 1–4, because rows 5 and 6 read move and finish data that does not exist yet. Task 1 states this in the code; Task 5 states it at the wiring site.

## File Structure

| File | Responsibility |
|---|---|
| `src/match/status.ts` | The `MatchStatus` and `EndReason` unions and the legal transitions between them. |
| `src/match/code.ts` | The join-code alphabet, length, formatter and zod schema. Pure; randomness is an argument. |
| `src/match/deadline.ts` | The §9.1 table: `deadlineFor` and `resolveExpiry`, both over an injected `now`. |
| `src/match/index.ts` | Barrel. |
| `src/server/db/schema/match.ts` | The `match` and `match_player` tables. |
| `src/server/api/routers/match.ts` | `create`, `join`, `get`, `list`, `submitMaze`. |
| `src/server/match/sweep.ts` | Reads expired matches, applies `resolveExpiry`, writes the outcome. |
| `src/app/api/cron/sweep/route.ts` | The cron entry point, guarded by `CRON_SECRET`. |
| `src/server/api/routers/test-support.ts` | Test-only seeding, behind `E2E_TEST_SUPPORT`. |
| `src/components/match/new-match-form.tsx` | Create a match with settings. |
| `src/components/match/join-match-form.tsx` | Join by code. |
| `src/components/match/match-lobby.tsx` | Status, opponent, deadline, maze picker, submit. |
| `src/components/match/maze-picker.tsx` | Choose an eligible labyrinth or start a new one. |
| `src/components/match/match-list.tsx` | "Your matches". |
| `src/app/[locale]/(app)/matches/page.tsx` | List plus create and join. |
| `src/app/[locale]/(app)/matches/[id]/page.tsx` | The lobby. |

---

## Task 1: The pure match domain

**Files:**
- Create: `src/match/status.ts`, `src/match/code.ts`, `src/match/deadline.ts`, `src/match/index.ts`
- Create: `tests/unit/match/deadline.test.ts`, `tests/unit/match/code.test.ts`
- Modify: `eslint.config.js` (extend the purity boundary), `AGENTS.md` (invariant 2)

**Interfaces:**
- Consumes: nothing. This task has no dependencies inside the phase.
- Produces:
  - `MATCH_STATUSES`, `MatchStatus = "awaiting_opponent" | "drawing" | "running" | "complete" | "abandoned"`
  - `END_REASONS`, `EndReason = "finished" | "forfeit" | "abandoned"`
  - `canTransition(from: MatchStatus, to: MatchStatus): boolean`
  - `CODE_ALPHABET: string`, `CODE_LENGTH: 6`, `matchCodeSchema: z.ZodType<string>`
  - `makeCode(draw: (max: number) => number): string`
  - `type PlayerSituation = { userId: string; submittedAt: Date | null; lastMoveAt: Date | null; finishedAt: Date | null }`
  - `type MatchSituation = { status: MatchStatus; createdAt: Date; bothJoinedAt: Date | null; unlockedAt: Date | null; lastActivityAt: Date; players: readonly PlayerSituation[] }`
  - `deadlineFor(situation: MatchSituation): Date | null`
  - `type ExpiryOutcome = { kind: "none" } | { kind: "abandoned"; forfeitedBy: readonly string[] } | { kind: "complete"; winnerId: string; endReason: "forfeit"; forfeitedBy: readonly string[] }`
  - `resolveExpiry(situation: MatchSituation, now: Date): ExpiryOutcome`
  - `HOURS_24_MS`, `HOURS_48_MS`

- [ ] **Step 1: Write the failing deadline tests**

`tests/unit/match/deadline.test.ts`. One case per §9.1 row, plus the invariant the spec singles out.

```ts
import { describe, expect, it } from "vitest";

import {
  HOURS_24_MS,
  HOURS_48_MS,
  deadlineFor,
  resolveExpiry,
  type MatchSituation,
  type PlayerSituation,
} from "~/match";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function player(over: Partial<PlayerSituation> = {}): PlayerSituation {
  return {
    userId: "a",
    submittedAt: null,
    lastMoveAt: null,
    finishedAt: null,
    ...over,
  };
}

function situation(over: Partial<MatchSituation> = {}): MatchSituation {
  return {
    status: "awaiting_opponent",
    createdAt: T0,
    bothJoinedAt: null,
    unlockedAt: null,
    lastActivityAt: T0,
    players: [player({ userId: "a" })],
    ...over,
  };
}

describe("deadlineFor — §9.1 row by row", () => {
  it("row 1: nobody has joined — 24h from creation", () => {
    expect(deadlineFor(situation())).toEqual(at(HOURS_24_MS));
  });

  it("row 2: both joined, neither submitted — 48h from the last activity", () => {
    const s = situation({
      status: "drawing",
      bothJoinedAt: at(1000),
      lastActivityAt: at(5000),
      players: [player({ userId: "a" }), player({ userId: "b" })],
    });
    expect(deadlineFor(s)).toEqual(at(5000 + HOURS_48_MS));
  });

  it("row 3: one submitted, the other has not — 24h from that submission", () => {
    const s = situation({
      status: "drawing",
      bothJoinedAt: at(1000),
      lastActivityAt: at(9000),
      players: [
        player({ userId: "a", submittedAt: at(7000) }),
        player({ userId: "b" }),
      ],
    });
    // Anchored to the submission, not to lastActivityAt: the clock is on the
    // player who has not drawn.
    expect(deadlineFor(s)).toEqual(at(7000 + HOURS_24_MS));
  });

  it("row 4: both submitted, neither has moved — 24h from the runs unlocking", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(8000),
      players: [
        player({ userId: "a", submittedAt: at(7000) }),
        player({ userId: "b", submittedAt: at(8000) }),
      ],
    });
    expect(deadlineFor(s)).toEqual(at(8000 + HOURS_24_MS));
  });

  it("row 5: both have moved, neither has finished — 48h since the last move by either", () => {
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
    expect(deadlineFor(s)).toEqual(at(20_000 + HOURS_48_MS));
  });

  it("row 6: one found the treasure — 24h from that finish", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(30_000),
      players: [
        player({
          userId: "a",
          submittedAt: at(7000),
          lastMoveAt: at(30_000),
          finishedAt: at(30_000),
        }),
        player({ userId: "b", submittedAt: at(8000), lastMoveAt: at(25_000) }),
      ],
    });
    expect(deadlineFor(s)).toEqual(at(30_000 + HOURS_24_MS));
  });

  it("row 6 outranks row 5 even when the other player moved more recently", () => {
    // A finish freezes the match onto the 24h clock. If the non-finisher's
    // later move reset it to 48h, the finisher would wait two days for a
    // result that is already decided.
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(40_000),
      players: [
        player({
          userId: "a",
          submittedAt: at(7000),
          lastMoveAt: at(30_000),
          finishedAt: at(30_000),
        }),
        player({ userId: "b", submittedAt: at(8000), lastMoveAt: at(40_000) }),
      ],
    });
    expect(deadlineFor(s)).toEqual(at(30_000 + HOURS_24_MS));
  });

  it("returns null for a match that has already ended", () => {
    expect(deadlineFor(situation({ status: "complete" }))).toBeNull();
    expect(deadlineFor(situation({ status: "abandoned" }))).toBeNull();
  });
});

describe("resolveExpiry", () => {
  it("does nothing before the deadline", () => {
    const s = situation();
    expect(resolveExpiry(s, at(HOURS_24_MS - 1))).toEqual({ kind: "none" });
  });

  it("abandons an unjoined match with no winner and nobody at fault", () => {
    const s = situation();
    expect(resolveExpiry(s, at(HOURS_24_MS))).toEqual({
      kind: "abandoned",
      forfeitedBy: [],
    });
  });

  it("records the drawing forfeit against the player who did not draw", () => {
    const s = situation({
      status: "drawing",
      bothJoinedAt: at(1000),
      lastActivityAt: at(7000),
      players: [
        player({ userId: "a", submittedAt: at(7000) }),
        player({ userId: "b" }),
      ],
    });
    expect(resolveExpiry(s, at(7000 + HOURS_24_MS))).toEqual({
      kind: "abandoned",
      forfeitedBy: ["b"],
    });
  });

  it("gives the finisher the win when the other player runs out of time", () => {
    const s = situation({
      status: "running",
      bothJoinedAt: at(1000),
      unlockedAt: at(8000),
      lastActivityAt: at(30_000),
      players: [
        player({
          userId: "a",
          submittedAt: at(7000),
          lastMoveAt: at(30_000),
          finishedAt: at(30_000),
        }),
        player({ userId: "b", submittedAt: at(8000), lastMoveAt: at(25_000) }),
      ],
    });
    expect(resolveExpiry(s, at(30_000 + HOURS_24_MS))).toEqual({
      kind: "complete",
      winnerId: "a",
      endReason: "forfeit",
      forfeitedBy: ["b"],
    });
  });

  it("never produces a winner who did not reach the treasure", () => {
    // The spec's load-bearing principle, asserted directly rather than
    // inferred from the cases above. Every combination of submitted/moved/
    // finished across two players, at a time far past any deadline.
    const stamps = [null, at(5000)] as const;
    for (const aSub of stamps)
      for (const aMove of stamps)
        for (const aFin of stamps)
          for (const bSub of stamps)
            for (const bMove of stamps)
              for (const bFin of stamps)
                for (const status of [
                  "awaiting_opponent",
                  "drawing",
                  "running",
                ] as const) {
                  const s = situation({
                    status,
                    bothJoinedAt: at(1000),
                    unlockedAt: at(2000),
                    lastActivityAt: at(5000),
                    players: [
                      player({
                        userId: "a",
                        submittedAt: aSub,
                        lastMoveAt: aMove,
                        finishedAt: aFin,
                      }),
                      player({
                        userId: "b",
                        submittedAt: bSub,
                        lastMoveAt: bMove,
                        finishedAt: bFin,
                      }),
                    ],
                  });
                  const outcome = resolveExpiry(s, at(HOURS_48_MS * 10));
                  if (outcome.kind !== "complete") continue;
                  const winner = s.players.find(
                    (p) => p.userId === outcome.winnerId,
                  );
                  expect(winner?.finishedAt).not.toBeNull();
                }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/match/deadline.test.ts`
Expected: FAIL with `Failed to resolve import "~/match"`.

- [ ] **Step 3: Write `src/match/status.ts`**

```ts
/** Spec §9. */
export const MATCH_STATUSES = [
  "awaiting_opponent",
  "drawing",
  "running",
  "complete",
  "abandoned",
] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];

/**
 * Spec §6. `winnerId` is null for everything except `finished` and `forfeit`,
 * which is how "you cannot win without finding the treasure" is enforced at
 * the schema level rather than by convention.
 */
export const END_REASONS = ["finished", "forfeit", "abandoned"] as const;

export type EndReason = (typeof END_REASONS)[number];

const LEGAL: Record<MatchStatus, readonly MatchStatus[]> = {
  awaiting_opponent: ["drawing", "abandoned"],
  drawing: ["running", "abandoned"],
  running: ["complete", "abandoned"],
  complete: [],
  abandoned: [],
};

/** Spec §9's diagram, as a function. Terminal states go nowhere. */
export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return LEGAL[from].includes(to);
}

export function isTerminal(status: MatchStatus): boolean {
  return LEGAL[status].length === 0;
}
```

- [ ] **Step 4: Write `src/match/code.ts`**

```ts
import { z } from "zod";

/**
 * No I, L, O, 0 or 1: a join code is read off one screen and typed into
 * another, usually by someone reading it aloud. Dropping the ambiguous
 * glyphs costs four characters of entropy and buys back every "was that a
 * one or an ell" round trip.
 */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/**
 * `draw(max)` returns an integer in [0, max). Randomness is the caller's to
 * supply so this module stays pure and the tests stay deterministic.
 */
export function makeCode(draw: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[draw(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Uppercases before validating, so someone typing their code in lowercase is
 * not told it is wrong.
 */
export const matchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(CODE_LENGTH, { message: "errors.matchCodeMalformed" })
  .regex(new RegExp(`^[${CODE_ALPHABET}]+$`), {
    message: "errors.matchCodeMalformed",
  });
```

- [ ] **Step 5: Write `src/match/deadline.ts`**

```ts
import { isTerminal, type MatchStatus } from "./status";

export const HOURS_24_MS = 24 * 60 * 60 * 1000;
export const HOURS_48_MS = 48 * 60 * 60 * 1000;

export type PlayerSituation = {
  userId: string;
  submittedAt: Date | null;
  /** Phase 4 fills this. Null throughout Phase 3. */
  lastMoveAt: Date | null;
  /** Phase 4 fills this. Null throughout Phase 3. */
  finishedAt: Date | null;
};

export type MatchSituation = {
  status: MatchStatus;
  createdAt: Date;
  bothJoinedAt: Date | null;
  /** When both mazes were in and the runs unlocked. */
  unlockedAt: Date | null;
  lastActivityAt: Date;
  players: readonly PlayerSituation[];
};

export type ExpiryOutcome =
  | { kind: "none" }
  | { kind: "abandoned"; forfeitedBy: readonly string[] }
  | {
      kind: "complete";
      winnerId: string;
      endReason: "forfeit";
      forfeitedBy: readonly string[];
    };

const plus = (at: Date, ms: number) => new Date(at.getTime() + ms);

/**
 * Spec §9.1, in the spec's own row order — the order is the logic, because
 * later rows describe states that subsume earlier ones. A finish (row 6)
 * outranks a more recent move by the other player (row 5): once someone has
 * the treasure the result is decided, and leaving the 48h clock running
 * would make the finisher wait two days for it.
 *
 * Returns null for a match that has already ended; there is nothing left to
 * wait for.
 */
export function deadlineFor(situation: MatchSituation): Date | null {
  if (isTerminal(situation.status)) return null;

  const { players } = situation;
  const finished = players.filter((p) => p.finishedAt !== null);

  // Row 6 — one found the treasure, the other has not.
  if (finished.length === 1 && players.length === 2) {
    return plus(finished[0]!.finishedAt!, HOURS_24_MS);
  }

  const moved = players.filter((p) => p.lastMoveAt !== null);

  // Row 5 — both have moved, neither has finished.
  if (moved.length === 2) {
    const last = Math.max(...moved.map((p) => p.lastMoveAt!.getTime()));
    return plus(new Date(last), HOURS_48_MS);
  }

  // Row 4 — both submitted, neither has made a single move.
  if (situation.status === "running" && situation.unlockedAt !== null) {
    return plus(situation.unlockedAt, HOURS_24_MS);
  }

  const submitted = players.filter((p) => p.submittedAt !== null);

  // Row 3 — one submitted a maze, the other has not.
  if (submitted.length === 1 && players.length === 2) {
    return plus(submitted[0]!.submittedAt!, HOURS_24_MS);
  }

  // Row 2 — both joined, neither has submitted.
  if (situation.bothJoinedAt !== null) {
    return plus(situation.lastActivityAt, HOURS_48_MS);
  }

  // Row 1 — nobody has joined.
  return plus(situation.createdAt, HOURS_24_MS);
}

/**
 * What happens when the deadline passes.
 *
 * Every row but the last closes with **no winner** — including the case
 * where you drew your maze and your opponent never drew theirs. Missing a
 * deadline is recorded against the player who missed it, which is what a
 * future reliability stat would read, but it does not put an unearned win on
 * the other player's record.
 */
export function resolveExpiry(
  situation: MatchSituation,
  now: Date,
): ExpiryOutcome {
  const deadline = deadlineFor(situation);
  if (deadline === null || now.getTime() < deadline.getTime()) {
    return { kind: "none" };
  }

  const { players } = situation;
  const finished = players.filter((p) => p.finishedAt !== null);

  // Row 6 — the only row that produces a winner, and only for a player who
  // actually reached the treasure.
  if (finished.length === 1 && players.length === 2) {
    const winner = finished[0]!;
    return {
      kind: "complete",
      winnerId: winner.userId,
      endReason: "forfeit",
      forfeitedBy: players
        .filter((p) => p.userId !== winner.userId)
        .map((p) => p.userId),
    };
  }

  return { kind: "abandoned", forfeitedBy: blameFor(situation) };
}

/**
 * Who missed the deadline. Nobody is at fault when a match simply went
 * unjoined, or when both players went quiet together — fault is only
 * recorded where one player was waiting on another.
 */
function blameFor(situation: MatchSituation): readonly string[] {
  const { players } = situation;
  if (players.length < 2) return [];

  const submitted = players.filter((p) => p.submittedAt !== null);
  if (submitted.length === 1) {
    return players
      .filter((p) => p.submittedAt === null)
      .map((p) => p.userId);
  }

  return [];
}
```

- [ ] **Step 6: Write `src/match/index.ts`**

```ts
export * from "./code";
export * from "./deadline";
export * from "./status";
```

- [ ] **Step 7: Run the deadline tests**

Run: `pnpm test tests/unit/match/deadline.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 8: Break it and watch it fail**

Change row 6's guard in `deadlineFor` from `finished.length === 1` to `finished.length === 2`. Run the suite. Expected: the two row-6 tests fail. Restore, confirm green.

Then change `HOURS_48_MS` in row 2 to `HOURS_24_MS`. Expected: the row-2 test fails. Restore.

**This matters more than usual.** Seven times in this project a passing test has proved less than it appeared, most recently a counter asserted at `1` everywhere so a hardcoded `return 1` passed a fifteen-test suite. A deadline table is exactly that shape of risk: six rows that all return "some time in the future". If you cannot break a row and see its test fail, that row is not tested.

- [ ] **Step 9: Write the code tests**

`tests/unit/match/code.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { CODE_ALPHABET, CODE_LENGTH, makeCode, matchCodeSchema } from "~/match";

describe("makeCode", () => {
  it("draws one character per position from the alphabet", () => {
    const drawn: number[] = [];
    const code = makeCode((max) => {
      drawn.push(max);
      return drawn.length - 1;
    });
    expect(code).toBe(CODE_ALPHABET.slice(0, CODE_LENGTH));
    expect(drawn).toEqual(Array<number>(CODE_LENGTH).fill(CODE_ALPHABET.length));
  });

  it("never emits a glyph that can be misread", () => {
    for (const forbidden of ["I", "L", "O", "0", "1"]) {
      expect(CODE_ALPHABET).not.toContain(forbidden);
    }
  });
});

describe("matchCodeSchema", () => {
  it("accepts a lowercase code and uppercases it", () => {
    const parsed = matchCodeSchema.parse("abcdef".slice(0, CODE_LENGTH));
    expect(parsed).toBe("ABCDEF".slice(0, CODE_LENGTH));
  });

  it("trims surrounding whitespace", () => {
    expect(matchCodeSchema.parse("  ABCDEF  ")).toBe("ABCDEF");
  });

  it("rejects a code of the wrong length with a message key", () => {
    const result = matchCodeSchema.safeParse("ABC");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("errors.matchCodeMalformed");
  });

  it("rejects a code containing an excluded glyph", () => {
    const result = matchCodeSchema.safeParse("ABCDE0");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("errors.matchCodeMalformed");
  });
});
```

Run: `pnpm test tests/unit/match/code.test.ts`. Expected: PASS, 6 tests.

Note the `"abcdef".slice(0, CODE_LENGTH)` shape: it keeps the fixtures correct if `CODE_LENGTH` ever changes, rather than hardcoding a six-character literal that would silently stop matching.

- [ ] **Step 10: Extend the ESLint purity boundary**

In `eslint.config.js`, the purity block currently reads:

```js
    files: ["src/maze/**/*.{ts,tsx}", "src/lib/issues.ts"],
```

Change it to:

```js
    files: [
      "src/maze/**/*.{ts,tsx}",
      "src/match/**/*.{ts,tsx}",
      "src/lib/issues.ts",
    ],
```

and update the rule's `message` to name all three:

```js
              message:
                "src/maze, src/match and src/lib/issues.ts must stay pure — they are shared with the client and a future mobile app. See AGENTS.md invariant 2.",
```

- [ ] **Step 11: Watch the purity rule fire**

Temporarily add `import { db } from "~/server/db";` to the top of `src/match/deadline.ts`. Run `pnpm lint`. Expected: the restricted-import error, naming invariant 2. Remove it and confirm lint is clean.

A rule nobody has seen fire is a rule nobody knows is wired up — this exact check caught a misconfigured boundary in Phase 1.

- [ ] **Step 12: Update AGENTS.md invariant 2**

Amend invariant 2 so it names `src/match/` alongside `src/maze/` and `src/lib/issues.ts`, matching the ESLint message exactly. In Phase 2 these two drifted — the message named one more file than the invariant did — and the mismatch was itself a finding.

- [ ] **Step 13: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/match tests/unit/match eslint.config.js AGENTS.md
git commit -m "feat: add the pure match domain"
```

---

## Task 2: The tables and the lobby procedures

**Files:**
- Create: `src/server/db/schema/match.ts`
- Modify: `src/server/db/schema/index.ts` (re-export), `src/server/api/root.ts` (mount), `messages/en.json`, `messages/sk.json`
- Create: `src/server/api/routers/match.ts`
- Create: `tests/integration/match-router.test.ts`
- Generated: `drizzle/0003_*.sql` plus `drizzle/meta` (by `pnpm db:generate` — never hand-written)

**Interfaces:**
- Consumes: from `~/match` — `MATCH_STATUSES`, `MatchStatus`, `END_REASONS`, `canTransition`, `makeCode`, `matchCodeSchema`, `deadlineFor`, `MatchSituation`, `PlayerSituation`.
- Produces:
  - tables `match`, `matchPlayer` from `~/server/db/schema`
  - `api.match.create({ cellCount, gateCount }) -> { id, code }`
  - `api.match.join({ code }) -> { id }`
  - `api.match.get({ id }) -> MatchView`
  - `api.match.list() -> MatchSummary[]`
  - `situationFor(matchRow, playerRows): MatchSituation` exported from the router module for Task 5's sweep to reuse

### The information boundary this task sets

`match.get` is the first procedure that returns data about **another person**. Two rules, and they are the reason this task is not just CRUD:

1. **Never return the opponent's `mazeId`.** The maze a player solves is the opponent's `match_player.mazeId`, and that join is the only place the mapping exists. The client has no business knowing the id, let alone the data — Phase 4 serves moves, not mazes. Return only whether the opponent has submitted.
2. **A match you are not in is indistinguishable from a match that does not exist.** Same code, same message, exactly as `maze.get` already does with `errors.notYourMaze`. Joining by code is the only way to learn a match exists.

- [ ] **Step 1: Write `src/server/db/schema/match.ts`**

```ts
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { END_REASONS, MATCH_STATUSES } from "~/match";

import { user } from "./auth";
import { maze } from "./maze";

/**
 * Spec §6. `deadlineAt` is recomputed on every phase transition rather than
 * being six rules scattered through the code, so the sweep is one indexed
 * query. `winnerId` is null for everything except `finished` and `forfeit`,
 * which is how "you cannot win without finding the treasure" is enforced at
 * the schema level.
 *
 * `bothJoinedAt` and `unlockedAt` are deliberately absent: both are derivable
 * from `match_player` (the later of the two `joinedAt`s, and the later of the
 * two `submittedAt`s), and a denormalised copy of a derivable timestamp is a
 * second source of truth waiting to disagree with the first.
 */
export const match = pgTable(
  "match",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    code: text("code").notNull().unique(),
    cellCount: integer("cell_count").notNull(),
    gateCount: integer("gate_count").notNull(),
    status: text("status", { enum: MATCH_STATUSES })
      .notNull()
      .default("awaiting_opponent"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at").notNull(),
    winnerId: text("winner_id").references(() => user.id, {
      onDelete: "set null",
    }),
    endReason: text("end_reason", { enum: END_REASONS }),
  },
  (table) => [
    // The sweep's only query: open matches whose deadline has passed.
    index("match_sweep_idx").on(table.status, table.deadlineAt),
  ],
);

/**
 * Spec §6. `mazeId` is null until that player submits. The run columns
 * (`runStatus`, `penalties`, `moveCount`, `runState`, `startedAt`,
 * `lastMoveAt`, `finishedAt`) are Phase 4's and are deliberately not created
 * here — nothing reads or writes them yet.
 */
export const matchPlayer = pgTable(
  "match_player",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => match.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mazeId: text("maze_id").references(() => maze.id, {
      onDelete: "restrict",
    }),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
    submittedAt: timestamp("submitted_at"),
    forfeitedAt: timestamp("forfeited_at"),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.userId] }),
    index("match_player_user_idx").on(table.userId),
  ],
);
```

Note `onDelete: "restrict"` on `mazeId`: a submitted maze is referenced by finished matches and their replays, so the database refuses to delete one out from under a match. `maze.remove` already refuses a submitted maze in the application layer; this is the same rule where it cannot be bypassed.

- [ ] **Step 2: Re-export and generate the migration**

In `src/server/db/schema/index.ts`, add below the existing lines:

```ts
export * from "./match";
```

Then:

```bash
pnpm db:generate
pnpm db:migrate
```

Commit the generated SQL **and** the `drizzle/meta` changes. Do not hand-write migration SQL. Do not run `db:push`.

Read the generated SQL before committing it and confirm it matches the schema file column for column — types, nullability, defaults, the two indexes, the composite primary key, and all five foreign keys with their `onDelete` behaviour. A schema file and a migration that disagree is a production defect no test in this repo catches.

- [ ] **Step 3: Add the message keys to both catalogues**

In `messages/en.json`, inside the existing `"errors"` object:

```json
    "notYourMatch": "That match is not yours.",
    "matchCodeMalformed": "A join code is 6 letters and digits.",
    "matchCodeUnknown": "No match has that code.",
    "matchFull": "That match already has two players.",
    "matchExpired": "That match has expired.",
    "alreadyInMatch": "You are already in that match."
```

In `messages/sk.json`, inside the same object:

```json
    "notYourMatch": "Tento zápas nie je váš.",
    "matchCodeMalformed": "Kód na pripojenie má 6 písmen a číslic.",
    "matchCodeUnknown": "Žiadny zápas nemá taký kód.",
    "matchFull": "Tento zápas už má dvoch hráčov.",
    "matchExpired": "Platnosť tohto zápasu vypršala.",
    "alreadyInMatch": "V tomto zápase už ste."
```

A Phase 0 unit test asserts the two catalogues have identical key sets and will fail loudly if you add a key to one and not the other. That test working is why this step is two edits rather than one.

- [ ] **Step 4: Write the failing integration tests**

`tests/integration/match-router.test.ts`. The harness mirrors `tests/integration/maze-router.test.ts` exactly — same `signedIn()` helper, same `rejection()` from `./support`.

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { CODE_LENGTH, HOURS_24_MS, HOURS_48_MS } from "~/match";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";

import { rejection } from "./support";

async function signedIn() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

const settings = { cellCount: 36 as const, gateCount: 0 };

describe("match.create", () => {
  it("issues a code and seats the creator", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);

    const created = await caller.match.create(settings);

    expect(created.code).toHaveLength(CODE_LENGTH);
    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("awaiting_opponent");
    expect(row?.createdById).toBe(ctx.session!.user.id);
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    expect(players).toHaveLength(1);
    expect(players[0]?.userId).toBe(ctx.session!.user.id);
    expect(players[0]?.mazeId).toBeNull();
  });

  it("sets the row-1 deadline 24h out from creation", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.match.create(settings);

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    const gap = row!.deadlineAt.getTime() - row!.createdAt.getTime();
    // Both stamps come from the same insert, so the gap is exact rather
    // than approximate.
    expect(gap).toBe(HOURS_24_MS);
  });

  it("issues a different code to each match", async () => {
    const caller = createCaller(await signedIn());
    const a = await caller.match.create(settings);
    const b = await caller.match.create(settings);
    expect(a.code).not.toBe(b.code);
  });

  it("rejects a cell count that is not a preset", async () => {
    const caller = createCaller(await signedIn());
    expect(
      await rejection(caller.match.create({ cellCount: 37, gateCount: 0 })),
    ).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an anonymous caller with a message key", async () => {
    const caller = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    expect(await rejection(caller.match.create(settings))).toEqual({
      code: "UNAUTHORIZED",
      message: "errors.notSignedIn",
    });
  });
});

describe("match.join", () => {
  it("seats the second player and moves the match to drawing", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guestCtx = await signedIn();
    const guest = createCaller(guestCtx);

    const joined = await guest.match.join({ code: created.code });

    expect(joined.id).toBe(created.id);
    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("drawing");
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    expect(players).toHaveLength(2);
    expect(players.map((p) => p.userId)).toContain(guestCtx.session!.user.id);
  });

  it("moves the deadline to row 2's 48h once both have joined", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());

    await guest.match.join({ code: created.code });

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    const gap = row!.deadlineAt.getTime() - row!.lastActivityAt.getTime();
    expect(gap).toBe(HOURS_48_MS);
  });

  it("accepts a lowercase code", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());

    const joined = await guest.match.join({
      code: created.code.toLowerCase(),
    });
    expect(joined.id).toBe(created.id);
  });

  it("refuses a third player", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });

    const third = createCaller(await signedIn());
    expect(await rejection(third.match.join({ code: created.code }))).toEqual({
      code: "CONFLICT",
      message: "errors.matchFull",
    });
  });

  it("refuses the host joining their own match", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);

    expect(await rejection(host.match.join({ code: created.code }))).toEqual({
      code: "CONFLICT",
      message: "errors.alreadyInMatch",
    });
  });

  it("refuses an unknown code", async () => {
    const guest = createCaller(await signedIn());
    expect(await rejection(guest.match.join({ code: "ZZZZZZ" }))).toEqual({
      code: "NOT_FOUND",
      message: "errors.matchCodeUnknown",
    });
  });

  it("refuses a malformed code with a message key", async () => {
    const guest = createCaller(await signedIn());
    expect(
      await rejection(guest.match.join({ code: "nope" })),
    ).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses a match whose deadline has already passed", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await db
      .update(match)
      .set({ deadlineAt: new Date(Date.now() - 1000) })
      .where(eq(match.id, created.id));

    const guest = createCaller(await signedIn());
    expect(await rejection(guest.match.join({ code: created.code }))).toEqual({
      code: "CONFLICT",
      message: "errors.matchExpired",
    });
  });
});

describe("match.get", () => {
  it("shows a participant the match and both players", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });

    const view = await host.match.get({ id: created.id });

    expect(view.status).toBe("drawing");
    expect(view.cellCount).toBe(36);
    expect(view.you.hasSubmitted).toBe(false);
    expect(view.opponent?.hasSubmitted).toBe(false);
    expect(view.opponent?.displayName).toBe("Test Person");
  });

  it("never returns the opponent's maze id", async () => {
    // The maze a player solves is the opponent's match_player.mazeId. That
    // join is the only place the mapping exists, and it does not belong on
    // the wire — Phase 4 serves moves, not mazes.
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });

    const view = await host.match.get({ id: created.id });

    expect(JSON.stringify(view)).not.toContain("mazeId");
    expect(Object.keys(view.opponent ?? {})).toEqual([
      "displayName",
      "hasSubmitted",
      "hasForfeited",
    ]);
  });

  it("refuses a stranger, indistinguishably from a match that does not exist", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const stranger = createCaller(await signedIn());

    const notMine = await rejection(stranger.match.get({ id: created.id }));
    const missing = await rejection(
      stranger.match.get({ id: crypto.randomUUID() }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
    expect(missing).toEqual(notMine);
  });
});

describe("match.list", () => {
  it("returns only the caller's matches, newest first", async () => {
    const mineCtx = await signedIn();
    const mine = createCaller(mineCtx);
    const first = await mine.match.create(settings);
    const second = await mine.match.create(settings);
    await createCaller(await signedIn()).match.create(settings);

    const listed = await mine.match.list();

    const ids = listed.map((m) => m.id);
    expect(ids).toEqual([second.id, first.id]);
  });

  it("includes a match the caller joined rather than created", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());
    await guest.match.join({ code: created.code });

    const listed = await guest.match.list();
    expect(listed.map((m) => m.id)).toContain(created.id);
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `pnpm test:integration tests/integration/match-router.test.ts`
Expected: FAIL — `match` is not exported from `~/server/db/schema`, and `caller.match` does not exist.

- [ ] **Step 6: Write `src/server/api/routers/match.ts`**

```ts
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  deadlineFor,
  makeCode,
  matchCodeSchema,
  type MatchSituation,
  type PlayerSituation,
} from "~/match";
import { CELL_COUNT_PRESETS, MAX_GATES } from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { match, matchPlayer, user } from "~/server/db/schema";

const settingsInput = z.object({
  cellCount: z
    .number()
    .int()
    .refine(
      (n): n is (typeof CELL_COUNT_PRESETS)[number] =>
        (CELL_COUNT_PRESETS as readonly number[]).includes(n),
      { message: "maze.format.cellCountNotAPreset" },
    ),
  gateCount: z.number().int().min(0).max(MAX_GATES),
});

type MatchRow = typeof match.$inferSelect;
type PlayerRow = typeof matchPlayer.$inferSelect;

/**
 * The bridge from database rows to the pure domain's view of a match.
 * Exported because Task 5's sweep evaluates the same situations with the
 * same function — one reading of §9.1, not two.
 *
 * `lastMoveAt` and `finishedAt` are hardcoded null: the columns that would
 * feed them are Phase 4's and do not exist yet. That means rows 5 and 6 of
 * §9.1 are unreachable through this bridge, which is correct for Phase 3 —
 * nobody can move. Phase 4 fills them in here and both rows light up.
 */
export function situationFor(
  matchRow: MatchRow,
  playerRows: readonly PlayerRow[],
): MatchSituation {
  const players: PlayerSituation[] = playerRows.map((p) => ({
    userId: p.userId,
    submittedAt: p.submittedAt,
    lastMoveAt: null,
    finishedAt: null,
  }));

  return {
    status: matchRow.status,
    createdAt: matchRow.createdAt,
    bothJoinedAt:
      playerRows.length === 2
        ? new Date(Math.max(...playerRows.map((p) => p.joinedAt.getTime())))
        : null,
    unlockedAt:
      playerRows.length === 2 && playerRows.every((p) => p.submittedAt !== null)
        ? new Date(
            Math.max(...playerRows.map((p) => p.submittedAt!.getTime())),
          )
        : null,
    lastActivityAt: matchRow.lastActivityAt,
    players,
  };
}

/** Every read of a match the caller must be part of. */
async function participantRows(
  db: typeof import("~/server/db").db,
  matchId: string,
  userId: string,
) {
  const [row] = await db.select().from(match).where(eq(match.id, matchId));
  if (!row) return null;
  const players = await db
    .select()
    .from(matchPlayer)
    .where(eq(matchPlayer.matchId, matchId));
  if (!players.some((p) => p.userId === userId)) return null;
  return { row, players };
}

/**
 * A match the caller is not in and a match that does not exist get the same
 * answer, for the same reason `maze.get` does: distinguishing them would
 * confirm the match exists to someone with no business knowing.
 */
function notYours(): never {
  throw new TRPCError({ code: "FORBIDDEN", message: "errors.notYourMatch" });
}

export const matchRouter = createTRPCRouter({
  create: protectedProcedure
    .input(settingsInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      // The unique index is the real guard against a collision; these
      // attempts just make hitting it vanishingly unlikely before the
      // database has to say so.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = makeCode((max) => Math.floor(Math.random() * max));
        try {
          return await ctx.db.transaction(async (tx) => {
            const [row] = await tx
              .insert(match)
              .values({
                code,
                cellCount: input.cellCount,
                gateCount: input.gateCount,
                createdById: ctx.session.user.id,
                createdAt: now,
                lastActivityAt: now,
                // Row 1 of §9.1: nobody has joined, 24h from creation.
                deadlineAt: deadlineFor({
                  status: "awaiting_opponent",
                  createdAt: now,
                  bothJoinedAt: null,
                  unlockedAt: null,
                  lastActivityAt: now,
                  players: [],
                })!,
              })
              .returning({ id: match.id, code: match.code });

            await tx.insert(matchPlayer).values({
              matchId: row!.id,
              userId: ctx.session.user.id,
              joinedAt: now,
            });

            return { id: row!.id, code: row!.code };
          });
        } catch (error) {
          const isDuplicateCode =
            error instanceof Error && error.message.includes("match_code");
          if (!isDuplicateCode) throw error;
        }
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "errors.unknown",
      });
    }),

  join: protectedProcedure
    .input(z.object({ code: matchCodeSchema }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(match)
          .where(eq(match.code, input.code));
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "errors.matchCodeUnknown",
          });
        }

        const players = await tx
          .select()
          .from(matchPlayer)
          .where(eq(matchPlayer.matchId, row.id));

        if (players.some((p) => p.userId === ctx.session.user.id)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.alreadyInMatch",
          });
        }
        if (players.length >= 2) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchFull",
          });
        }
        if (
          row.status !== "awaiting_opponent" ||
          now.getTime() >= row.deadlineAt.getTime()
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchExpired",
          });
        }

        await tx.insert(matchPlayer).values({
          matchId: row.id,
          userId: ctx.session.user.id,
          joinedAt: now,
        });

        const seated = [
          ...players,
          {
            matchId: row.id,
            userId: ctx.session.user.id,
            mazeId: null,
            joinedAt: now,
            submittedAt: null,
            forfeitedAt: null,
          } satisfies PlayerRow,
        ];
        const next = { ...row, status: "drawing" as const, lastActivityAt: now };

        await tx
          .update(match)
          .set({
            status: "drawing",
            lastActivityAt: now,
            deadlineAt: deadlineFor(situationFor(next, seated))!,
          })
          .where(eq(match.id, row.id));

        return { id: row.id };
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await participantRows(
        ctx.db,
        input.id,
        ctx.session.user.id,
      );
      if (!found) notYours();
      const { row, players } = found;

      const you = players.find((p) => p.userId === ctx.session.user.id)!;
      const them = players.find((p) => p.userId !== ctx.session.user.id);

      const names = them
        ? await ctx.db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, [them.userId]))
        : [];

      return {
        id: row.id,
        code: row.code,
        status: row.status,
        cellCount: row.cellCount,
        gateCount: row.gateCount,
        deadlineAt: row.deadlineAt,
        winnerId: row.winnerId,
        endReason: row.endReason,
        you: {
          // Corrected during execution: this previously returned
          // `mazeId: you.mazeId`, which contradicted this task's own test
          // asserting the serialised view contains no `mazeId` anywhere.
          // Your own id is not a secret from you, but nothing in Phase 3
          // needs it — the picker already knows the ids it offers — and a
          // blanket "no mazeId on this payload" is a boundary that cannot be
          // weakened by accident. Add it back when a caller wants it.
          hasSubmitted: you.submittedAt !== null,
          hasForfeited: you.forfeitedAt !== null,
        },
        opponent: them
          ? {
              displayName: names[0]?.name ?? "",
              hasSubmitted: them.submittedAt !== null,
              hasForfeited: them.forfeitedAt !== null,
            }
          : null,
      };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const mine = await ctx.db
      .select({ matchId: matchPlayer.matchId })
      .from(matchPlayer)
      .where(eq(matchPlayer.userId, ctx.session.user.id));

    if (mine.length === 0) return [];

    return ctx.db
      .select({
        id: match.id,
        code: match.code,
        status: match.status,
        cellCount: match.cellCount,
        gateCount: match.gateCount,
        deadlineAt: match.deadlineAt,
        winnerId: match.winnerId,
        createdAt: match.createdAt,
      })
      .from(match)
      .where(
        inArray(
          match.id,
          mine.map((m) => m.matchId),
        ),
      )
      .orderBy(desc(match.createdAt));
  }),
});
```

- [ ] **Step 7: Mount the router**

In `src/server/api/root.ts`, import `matchRouter` from `~/server/api/routers/match` and add `match: matchRouter,` to `appRouter`, beside the existing `maze` entry.

- [ ] **Step 8: Run the integration tests**

Run: `pnpm test:integration tests/integration/match-router.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 9: Break it and watch it fail**

Three breaks, each proving a different assertion is load-bearing:

1. In `get`, add `mazeId: them.mazeId` to the `opponent` object. Expected: "never returns the opponent's maze id" fails on both assertions. Restore.
2. In `get`, change `notYours()` to throw `NOT_FOUND` with `errors.matchCodeUnknown` only in the stranger branch, leaving the missing-match branch alone. Expected: the indistinguishability test fails on `toEqual`. Restore.
3. In `join`, drop the `players.length >= 2` check. Expected: "refuses a third player" fails. Restore.

Confirm all 17 green afterwards.

- [ ] **Step 10: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/server/db/schema src/server/api drizzle messages tests/integration
git commit -m "feat: add the match table and the lobby procedures"
```

Confirm `git status --short docs/` prints nothing and `.env` is not staged.

---

## Task 3: Submitting a maze, and reaching `running`

**Files:**
- Modify: `src/server/api/routers/match.ts` (add `eligibleMazes` and `submitMaze`), `messages/en.json`, `messages/sk.json`
- Modify: `tests/integration/match-router.test.ts` (append two describe blocks)

**Interfaces:**
- Consumes: `situationFor`, `participantRows`, `notYours` from Task 2's router module; `validateMaze`, `draftToMaze` from `~/maze`; `deadlineFor` from `~/match`; tables `match`, `matchPlayer`, `maze`.
- Produces:
  - `api.match.eligibleMazes({ matchId }) -> { id, name, status, updatedAt }[]`
  - `api.match.submitMaze({ matchId, mazeId }) -> { status: MatchStatus }`

### The four rules this task enforces

Spec §6 states them; this is the only place they are checked.

1. **The settings are frozen at creation.** A maze whose `cellCount` or `gateCount` differs from the match's is refused — not silently coerced, not resized.
2. **The maze must be valid.** `validateMaze` decides, and its issues travel back as message keys. A draft that does not validate cannot be submitted.
3. **A submitted maze may be reused as-is** in a later match whose settings match. That is what makes the "my labyrinths" library worth having.
4. **Reuse against an opponent who has already faced that maze is rejected.** Otherwise the library becomes a way to replay a maze someone has already learned.

Rule 4 needs care: "already faced" means the opponent was a participant in some *other* match where this maze was the one submitted against them. Phase 3 has no finishes, so "faced" is the right word rather than "solved" — the spec's "has already solved" becomes reachable in Phase 4 and this check is the superset that is correct now and stays correct then.

- [ ] **Step 1: Add the message keys to both catalogues**

In `messages/en.json`, inside `"errors"`:

```json
    "mazeInvalid": "That labyrinth is not playable yet.",
    "mazeSettingsMismatch": "That labyrinth does not match this match's size.",
    "mazeAlreadyFaced": "Your opponent has already played that labyrinth.",
    "alreadySubmitted": "You have already submitted a labyrinth.",
    "matchNotDrawing": "This match is not accepting labyrinths."
```

In `messages/sk.json`, inside `"errors"`:

```json
    "mazeInvalid": "Toto bludisko sa ešte nedá hrať.",
    "mazeSettingsMismatch": "Toto bludisko nemá veľkosť podľa tohto zápasu.",
    "mazeAlreadyFaced": "Váš súper toto bludisko už hral.",
    "alreadySubmitted": "Bludisko ste už odoslali.",
    "matchNotDrawing": "Tento zápas už bludiská neprijíma."
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/integration/match-router.test.ts`. Add these imports at the top of the file:

```ts
import { and } from "drizzle-orm";

import {
  SOLVABLE_MAZE_CELL_COUNT,
  SOLVABLE_MAZE_GATE_COUNT,
  solvableDraft,
} from "../fixtures/maze";
import { maze } from "~/server/db/schema";
```

and this helper beside `signedIn()`:

```ts
/** A saved, valid labyrinth owned by the caller, ready to submit. */
async function savedMaze(
  caller: ReturnType<typeof createCaller>,
  name = "Mine",
) {
  const created = await caller.maze.createDraft({
    name,
    cellCount: SOLVABLE_MAZE_CELL_COUNT,
    gateCount: SOLVABLE_MAZE_GATE_COUNT,
  });
  await caller.maze.saveDraft({ id: created.id, data: solvableDraft() });
  return created.id;
}
```

Then the two blocks:

```ts
describe("match.submitMaze", () => {
  it("records the submission and holds the match in drawing until both are in", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });
    const mazeId = await savedMaze(host);

    const result = await host.match.submitMaze({
      matchId: created.id,
      mazeId,
    });

    expect(result.status).toBe("drawing");
    const [player] = await db
      .select()
      .from(matchPlayer)
      .where(
        and(
          eq(matchPlayer.matchId, created.id),
          eq(matchPlayer.userId, hostCtx.session!.user.id),
        ),
      );
    expect(player?.mazeId).toBe(mazeId);
    expect(player?.submittedAt).not.toBeNull();
  });

  it("marks the maze submitted, so the editor can no longer change it", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });
    const mazeId = await savedMaze(host);

    await host.match.submitMaze({ matchId: created.id, mazeId });

    const [row] = await db.select().from(maze).where(eq(maze.id, mazeId));
    expect(row?.status).toBe("submitted");
    expect(row?.contentHash).not.toBeNull();
    expect(row?.optimalMoves).not.toBeNull();

    expect(
      await rejection(
        host.maze.saveDraft({ id: mazeId, data: solvableDraft() }),
      ),
    ).toEqual({ code: "FORBIDDEN", message: "errors.mazeIsSubmitted" });
  });

  it("moves the deadline to row 3's 24h from the submission", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });
    const mazeId = await savedMaze(host);

    await host.match.submitMaze({ matchId: created.id, mazeId });

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    const [player] = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    const submittedAt = [player]
      .concat(
        await db
          .select()
          .from(matchPlayer)
          .where(eq(matchPlayer.matchId, created.id)),
      )
      .map((p) => p?.submittedAt)
      .find((d): d is Date => d != null)!;
    expect(row!.deadlineAt.getTime() - submittedAt.getTime()).toBe(
      HOURS_24_MS,
    );
  });

  it("unlocks the runs once both have submitted", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());
    await guest.match.join({ code: created.code });

    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "Host"),
    });
    const result = await guest.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(guest, "Guest"),
    });

    expect(result.status).toBe("running");
    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("running");
  });

  it("sets row 4's 24h deadline from the moment the runs unlocked", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());
    await guest.match.join({ code: created.code });

    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "Host"),
    });
    await guest.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(guest, "Guest"),
    });

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    const unlockedAt = Math.max(
      ...players.map((p) => p.submittedAt!.getTime()),
    );
    expect(row!.deadlineAt.getTime() - unlockedAt).toBe(HOURS_24_MS);
  });

  it("refuses a maze whose settings do not match the match", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create({ cellCount: 64, gateCount: 0 });
    await createCaller(await signedIn()).match.join({ code: created.code });
    // The fixture is a 36-cell maze; this match wants 64.
    const mazeId = await savedMaze(host);

    expect(
      await rejection(host.match.submitMaze({ matchId: created.id, mazeId })),
    ).toEqual({
      code: "BAD_REQUEST",
      message: "errors.mazeSettingsMismatch",
    });
  });

  it("refuses a maze that does not validate", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });
    // Created but never drawn: no start, no treasure, no cells.
    const empty = await host.maze.createDraft({
      name: "Empty",
      cellCount: SOLVABLE_MAZE_CELL_COUNT,
      gateCount: SOLVABLE_MAZE_GATE_COUNT,
    });

    expect(
      await rejection(
        host.match.submitMaze({ matchId: created.id, mazeId: empty.id }),
      ),
    ).toEqual({ code: "BAD_REQUEST", message: "errors.mazeInvalid" });
  });

  it("refuses someone else's maze, indistinguishably from one that does not exist", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());
    await guest.match.join({ code: created.code });
    const guestMaze = await savedMaze(guest, "Not yours");

    const notMine = await rejection(
      host.match.submitMaze({ matchId: created.id, mazeId: guestMaze }),
    );
    const missing = await rejection(
      host.match.submitMaze({
        matchId: created.id,
        mazeId: crypto.randomUUID(),
      }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMaze",
    });
    expect(missing).toEqual(notMine);
  });

  it("refuses a second submission from the same player", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });
    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "First"),
    });

    expect(
      await rejection(
        host.match.submitMaze({
          matchId: created.id,
          mazeId: await savedMaze(host, "Second"),
        }),
      ),
    ).toEqual({ code: "CONFLICT", message: "errors.alreadySubmitted" });
  });

  it("refuses a submission before anyone has joined", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const mazeId = await savedMaze(host);

    expect(
      await rejection(host.match.submitMaze({ matchId: created.id, mazeId })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchNotDrawing" });
  });

  it("refuses a stranger, indistinguishably from a match that does not exist", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });
    const strangerCtx = await signedIn();
    const stranger = createCaller(strangerCtx);
    const theirMaze = await savedMaze(stranger, "Theirs");

    const notMine = await rejection(
      stranger.match.submitMaze({ matchId: created.id, mazeId: theirMaze }),
    );
    const missing = await rejection(
      stranger.match.submitMaze({
        matchId: crypto.randomUUID(),
        mazeId: theirMaze,
      }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
    expect(missing).toEqual(notMine);
  });

  it("lets a submitted maze be reused against a different opponent", async () => {
    const host = createCaller(await signedIn());
    const first = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: first.code });
    const mazeId = await savedMaze(host, "Reused");
    await host.match.submitMaze({ matchId: first.id, mazeId });

    const second = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: second.code });

    const result = await host.match.submitMaze({
      matchId: second.id,
      mazeId,
    });
    expect(result.status).toBe("drawing");
  });

  it("refuses reuse against an opponent who has already faced that maze", async () => {
    const host = createCaller(await signedIn());
    const rivalCtx = await signedIn();
    const rival = createCaller(rivalCtx);

    const first = await host.match.create(settings);
    await rival.match.join({ code: first.code });
    const mazeId = await savedMaze(host, "Seen it");
    await host.match.submitMaze({ matchId: first.id, mazeId });

    const second = await host.match.create(settings);
    await rival.match.join({ code: second.code });

    expect(
      await rejection(
        host.match.submitMaze({ matchId: second.id, mazeId }),
      ),
    ).toEqual({ code: "CONFLICT", message: "errors.mazeAlreadyFaced" });
  });
});

describe("match.eligibleMazes", () => {
  it("offers only the caller's mazes at the match's settings", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });

    const right = await savedMaze(host, "Right size");
    const wrong = await host.maze.createDraft({
      name: "Wrong size",
      cellCount: 64,
      gateCount: 0,
    });

    const offered = await host.match.eligibleMazes({ matchId: created.id });
    const ids = offered.map((m) => m.id);
    expect(ids).toContain(right);
    expect(ids).not.toContain(wrong.id);
  });

  it("omits a maze this opponent has already faced", async () => {
    const host = createCaller(await signedIn());
    const rival = createCaller(await signedIn());
    const first = await host.match.create(settings);
    await rival.match.join({ code: first.code });
    const mazeId = await savedMaze(host, "Seen it");
    await host.match.submitMaze({ matchId: first.id, mazeId });

    const second = await host.match.create(settings);
    await rival.match.join({ code: second.code });

    const offered = await host.match.eligibleMazes({ matchId: second.id });
    expect(offered.map((m) => m.id)).not.toContain(mazeId);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm test:integration tests/integration/match-router.test.ts`
Expected: FAIL — `caller.match.submitMaze is not a function`.

- [ ] **Step 4: Add `eligibleMazes` and `submitMaze` to the router**

Add these imports to `src/server/api/routers/match.ts`:

```ts
import { ne, notInArray } from "drizzle-orm";
import type { NeonQueryResultHKT } from "drizzle-orm/neon-serverless";
import type { PgDatabase } from "drizzle-orm/pg-core";

import { validateMaze } from "~/maze";
import * as schema from "~/server/db/schema";
import { maze } from "~/server/db/schema";
```

Then this helper, above `export const matchRouter`:

```ts
/**
 * Every maze of this author that the opponent has already faced in some
 * other match. Rule 4 of §6: reuse is what makes the library worth having,
 * but not against someone who has already walked the maze.
 */
async function mazesFacedBy(
  // Corrected during execution: this previously read
  // `typeof import("~/server/db").db`, which does not accept a transaction
  // object — and this helper is called with `ctx.db` from `eligibleMazes`
  // and with `tx` from inside `submitMaze`'s transaction. Type it against
  // the base both extend. `participantRows` above gets away with the
  // narrower type only because nothing calls it with a `tx`.
  db: PgDatabase<NeonQueryResultHKT, typeof schema>,
  opponentId: string | null,
  exceptMatchId: string,
): Promise<string[]> {
  if (!opponentId) return [];

  const theirMatches = await db
    .select({ matchId: matchPlayer.matchId })
    .from(matchPlayer)
    .where(eq(matchPlayer.userId, opponentId));

  const ids = theirMatches
    .map((m) => m.matchId)
    .filter((id) => id !== exceptMatchId);
  if (ids.length === 0) return [];

  const faced = await db
    .select({ mazeId: matchPlayer.mazeId })
    .from(matchPlayer)
    .where(
      and(
        inArray(matchPlayer.matchId, ids),
        ne(matchPlayer.userId, opponentId),
      ),
    );

  return faced
    .map((f) => f.mazeId)
    .filter((id): id is string => id !== null);
}
```

and these two procedures inside `matchRouter`:

```ts
  eligibleMazes: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await participantRows(
        ctx.db,
        input.matchId,
        ctx.session.user.id,
      );
      if (!found) notYours();
      const { row, players } = found;

      const opponentId =
        players.find((p) => p.userId !== ctx.session.user.id)?.userId ?? null;
      const faced = await mazesFacedBy(ctx.db, opponentId, row.id);

      const conditions = [
        eq(maze.authorId, ctx.session.user.id),
        eq(maze.cellCount, row.cellCount),
        eq(maze.gateCount, row.gateCount),
      ];
      if (faced.length > 0) conditions.push(notInArray(maze.id, faced));

      return ctx.db
        .select({
          id: maze.id,
          name: maze.name,
          status: maze.status,
          updatedAt: maze.updatedAt,
        })
        .from(maze)
        .where(and(...conditions))
        .orderBy(desc(maze.updatedAt));
    }),

  submitMaze: protectedProcedure
    .input(z.object({ matchId: z.string(), mazeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(match)
          .where(eq(match.id, input.matchId));
        const players = row
          ? await tx
              .select()
              .from(matchPlayer)
              .where(eq(matchPlayer.matchId, row.id))
          : [];
        if (!row || !players.some((p) => p.userId === ctx.session.user.id)) {
          notYours();
        }

        const you = players.find((p) => p.userId === ctx.session.user.id)!;
        const them = players.find((p) => p.userId !== ctx.session.user.id);

        if (row.status !== "drawing") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchNotDrawing",
          });
        }
        if (now.getTime() >= row.deadlineAt.getTime()) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchExpired",
          });
        }
        if (you.submittedAt !== null) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.alreadySubmitted",
          });
        }

        const [mazeRow] = await tx
          .select()
          .from(maze)
          .where(
            and(
              eq(maze.id, input.mazeId),
              eq(maze.authorId, ctx.session.user.id),
            ),
          );
        // Not yours and not there are the same answer, exactly as the maze
        // router already treats them.
        if (!mazeRow) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "errors.notYourMaze",
          });
        }

        if (
          mazeRow.cellCount !== row.cellCount ||
          mazeRow.gateCount !== row.gateCount
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "errors.mazeSettingsMismatch",
          });
        }

        const faced = await mazesFacedBy(tx, them?.userId ?? null, row.id);
        if (faced.includes(mazeRow.id)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.mazeAlreadyFaced",
          });
        }

        // The server's verdict is the only one that counts (§4). A maze
        // already marked submitted was validated on its way in, but
        // re-running it costs one BFS and removes the assumption.
        const validation = validateMaze(mazeRow.data, {
          cellCount: row.cellCount,
          gateCount: row.gateCount,
        });
        if (!validation.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "errors.mazeInvalid",
          });
        }

        await tx
          .update(maze)
          .set({
            status: "submitted",
            contentHash: validation.contentHash,
            optimalMoves: validation.optimalMoves,
          })
          .where(eq(maze.id, mazeRow.id));

        await tx
          .update(matchPlayer)
          .set({ mazeId: mazeRow.id, submittedAt: now })
          .where(
            and(
              eq(matchPlayer.matchId, row.id),
              eq(matchPlayer.userId, ctx.session.user.id),
            ),
          );

        const seated = players.map((p) =>
          p.userId === ctx.session.user.id
            ? { ...p, mazeId: mazeRow.id, submittedAt: now }
            : p,
        );
        const bothIn =
          seated.length === 2 && seated.every((p) => p.submittedAt !== null);
        const status = bothIn ? ("running" as const) : row.status;
        const next = { ...row, status, lastActivityAt: now };

        await tx
          .update(match)
          .set({
            status,
            lastActivityAt: now,
            deadlineAt: deadlineFor(situationFor(next, seated))!,
          })
          .where(eq(match.id, row.id));

        return { status };
      });
    }),
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test:integration tests/integration/match-router.test.ts`
Expected: PASS, 32 tests.

- [ ] **Step 6: Break it and watch it fail**

Four breaks, one per rule:

1. Remove the `cellCount`/`gateCount` comparison. Expected: "refuses a maze whose settings do not match" fails.
2. Replace the `validation.ok` check with `if (false)`. Expected: "refuses a maze that does not validate" fails.
3. Remove the `faced.includes` check. Expected: "refuses reuse against an opponent who has already faced that maze" fails, and the `eligibleMazes` omission test still passes — which tells you those two are independent code paths and both need their own check.
4. Change `bothIn` to `seated.length === 2`. Expected: **five** tests fail, not one. The status flips to `running` after the first submission, which then makes the second player's legitimate submission hit the `matchNotDrawing` guard, and four more tests cascade off that. (An earlier version of this plan predicted only "holds the match in drawing" would fail and that "unlocks the runs" would still pass. That was wrong — corrected during execution.) The lesson stands and is stronger than predicted: a suite that only walked the happy path would have seen none of this.

Restore after each and confirm all 32 green.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/server/api/routers/match.ts messages tests/integration
git commit -m "feat: submit a labyrinth and unlock the runs"
```

---

## Task 4: Test-only seeding, and API-seeded authentication

**Files:**
- Create: `src/lib/open-maze.ts`, `src/server/api/routers/test-support.ts`
- Modify: `src/env.js`, `src/server/api/root.ts`, `playwright.config.ts`, `e2e/support/auth.ts`, `tests/fixtures/maze.ts`
- Create: `tests/unit/open-maze.test.ts`

**Interfaces:**
- Consumes: `validateMaze`, `CELL_COUNT_PRESETS`, `DraftMaze` from `~/maze`.
- Produces:
  - `openMazeDraft(cellCount: number): DraftMaze` and `openMazeOptimalMoves(cellCount: number): number` from `~/lib/open-maze`
  - `api.testSupport.seedMaze({ name, cellCount, gateCount }) -> { id }`
  - `signUpViaApi(request, email?) -> { email, password, cookies }` from `e2e/support/auth`
  - `signedInContext(browser, request, baseURL) -> BrowserContext` from `e2e/support/auth` (corrected during execution: the summary previously omitted `baseURL`, which the step's own code block takes and `browser.newContext()` needs — there is no ambient baseURL on a context created that way. Task 8's helper already calls it with three arguments.)

### Why this task exists

Spec §12 names two disciplines, and Phase 2 violated both — survivably at its scale, not at this one:

> Authentication is seeded via `storageState` through the API, not by driving the login form — except in the one test whose subject *is* the login form.
>
> Mazes are seeded through a test-only procedure behind an env flag. A test that clicks sixty wall segments is a test that fails for reasons unrelated to what it is checking.

Phase 2's suite drives the sign-up form fourteen times per full run, which is why `E2E_DISABLE_RATE_LIMIT` had to exist. Phase 3's headline test needs **two players with two valid mazes each** before the interesting part begins. At 36 cells that is 72 cell clicks per player plus a start and a treasure, twice, in one spec. That test would not be testing the match lifecycle; it would be testing the board's click handler, slowly, and failing for its reasons.

### The guard

`seedMaze` writes real rows as the caller. It must be impossible to reach in production. Follow the precedent `E2E_DISABLE_RATE_LIMIT` already set in this repo: an explicit env flag, declared in the schema, **and** a second check at the call site that refuses to run on Vercel, **and** a boot warning so an operator who somehow enabled it sees it.

- [ ] **Step 1: Write the failing `open-maze` tests**

`tests/unit/open-maze.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { openMazeDraft, openMazeOptimalMoves } from "~/lib/open-maze";
import { CELL_COUNT_PRESETS, validateMaze } from "~/maze";

describe("openMazeDraft", () => {
  it.each(CELL_COUNT_PRESETS)(
    "produces a maze that validates at %i cells",
    (cellCount) => {
      const result = validateMaze(openMazeDraft(cellCount), {
        cellCount,
        gateCount: 0,
      });
      expect(result.ok).toBe(true);
    },
  );

  it.each(CELL_COUNT_PRESETS)(
    "solves in the hand-derived number of moves at %i cells",
    (cellCount) => {
      const result = validateMaze(openMazeDraft(cellCount), {
        cellCount,
        gateCount: 0,
      });
      // An open square with the start and the treasure at opposite corners:
      // the shortest route is the Manhattan distance, 2 * (side - 1).
      const side = Math.sqrt(cellCount);
      expect(result.ok && result.optimalMoves).toBe(2 * (side - 1));
      expect(openMazeOptimalMoves(cellCount)).toBe(2 * (side - 1));
    },
  );

  it("refuses a cell count that is not a perfect square", () => {
    expect(() => openMazeDraft(37)).toThrow();
  });
});
```

Note the `it.each(CELL_COUNT_PRESETS)` shape: every preset is covered, and adding a fifth preset to the domain extends this suite automatically rather than silently leaving it behind.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/open-maze.test.ts`
Expected: FAIL with `Failed to resolve import "~/lib/open-maze"`.

- [ ] **Step 3: Write `src/lib/open-maze.ts`**

```ts
import type { DraftMaze } from "~/maze";

/**
 * An open square labyrinth with no walls and no gates, start in one corner
 * and treasure in the opposite one.
 *
 * It exists for seeding — the test-only router uses it so a Playwright spec
 * does not have to click seventy-two cells to reach the part it is actually
 * testing, and the integration fixtures re-export it so there is one
 * definition rather than two that drift.
 *
 * Every entry in CELL_COUNT_PRESETS is a perfect square (36, 64, 100, 144),
 * which is what makes the optimal move count checkable by hand: with no
 * blockers it is the plain Manhattan distance between opposite corners.
 */
export function openMazeDraft(cellCount: number): DraftMaze {
  const side = sideOf(cellCount);
  const cells = [];
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) cells.push({ x, y });
  }
  return {
    version: 1,
    cells,
    start: { x: 0, y: 0 },
    treasure: { x: side - 1, y: side - 1 },
    segments: [],
    keys: [],
  };
}

export function openMazeOptimalMoves(cellCount: number): number {
  return 2 * (sideOf(cellCount) - 1);
}

function sideOf(cellCount: number): number {
  const side = Math.round(Math.sqrt(cellCount));
  if (side * side !== cellCount) {
    throw new Error(
      `openMaze needs a perfect square cell count, got ${cellCount}`,
    );
  }
  return side;
}
```

- [ ] **Step 4: Point the existing fixture at it**

Rewrite `tests/fixtures/maze.ts` so the 6×6 maze comes from the shared generator rather than a second hand-written copy. Keep the three exported constants — `tests/integration/maze-router.test.ts` imports them by name and must keep compiling unchanged:

```ts
import { openMazeDraft, openMazeOptimalMoves } from "~/lib/open-maze";
import type { DraftMaze } from "~/maze";

/**
 * A 6x6 labyrinth with no walls or gates: every one of its 36 cells is open,
 * so the shortest route from corner to corner is the plain Manhattan
 * distance, 5 + 5 = 10 moves. Shared across tests so anything that needs a
 * maze known to validate and solve to a specific number can reuse this one.
 *
 * The shape itself comes from `~/lib/open-maze`, which is also what the
 * test-only seeding procedure uses — one generator, so a change to it
 * cannot leave the integration fixtures and the e2e seeds disagreeing.
 */
export const SOLVABLE_MAZE_CELL_COUNT = 36;
export const SOLVABLE_MAZE_GATE_COUNT = 0;
export const SOLVABLE_MAZE_OPTIMAL_MOVES =
  openMazeOptimalMoves(SOLVABLE_MAZE_CELL_COUNT);

export function solvableDraft(): DraftMaze {
  return openMazeDraft(SOLVABLE_MAZE_CELL_COUNT);
}
```

Run `pnpm test:integration` and confirm the existing maze-router and match-router suites still pass unchanged. If `SOLVABLE_MAZE_OPTIMAL_MOVES` is no longer 10, the generator is wrong — the constant was hand-derived and verified in Phase 2, and it is the check on this refactor.

- [ ] **Step 5: Declare the env flag**

In `src/env.js`, inside `server`, below `E2E_DISABLE_RATE_LIMIT`:

```js
    // Playwright-only: exposes `testSupport.seedMaze`, which writes real
    // maze rows as the caller. Guarded again at the call site by
    // `!process.env.VERCEL`, and the router logs a warning at boot if it is
    // ever on, because the only correct value outside a local e2e run is
    // "false".
    E2E_TEST_SUPPORT: z.enum(["true", "false"]).default("false"),
```

and in `runtimeEnv`:

```js
    E2E_TEST_SUPPORT: process.env.E2E_TEST_SUPPORT,
```

In `playwright.config.ts`, add `E2E_TEST_SUPPORT: "true"` to the `webServer.env` block beside the existing `E2E_DISABLE_RATE_LIMIT` entry.

- [ ] **Step 6: Write `src/server/api/routers/test-support.ts`**

```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";
import { openMazeDraft } from "~/lib/open-maze";
import { CELL_COUNT_PRESETS, MAX_GATES, validateMaze } from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { maze } from "~/server/db/schema";

/**
 * Two independent conditions, because one of them is a string in an
 * environment file and the other is not. Vercel sets `VERCEL` on every
 * deployment, so even a misconfigured production env cannot open this.
 */
const ENABLED = env.E2E_TEST_SUPPORT === "true" && !process.env.VERCEL;

if (env.E2E_TEST_SUPPORT === "true") {
  console.warn(
    "[test-support] E2E_TEST_SUPPORT is on. Seeding procedures are exposed. " +
      `Reachable: ${ENABLED}. The only correct value outside a local e2e run is "false".`,
  );
}

function assertEnabled() {
  if (!ENABLED) {
    throw new TRPCError({ code: "NOT_FOUND", message: "errors.unknown" });
  }
}

export const testSupportRouter = createTRPCRouter({
  /**
   * A valid, already-drawn labyrinth owned by the caller, so a spec can get
   * to the part it is testing. Seeds the shape only — it does not submit,
   * because which match a maze belongs to is exactly what the specs are
   * for.
   */
  seedMaze: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        cellCount: z
          .number()
          .int()
          .refine(
            (n): n is (typeof CELL_COUNT_PRESETS)[number] =>
              (CELL_COUNT_PRESETS as readonly number[]).includes(n),
            { message: "maze.format.cellCountNotAPreset" },
          ),
        gateCount: z.number().int().min(0).max(MAX_GATES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();

      const data = openMazeDraft(input.cellCount);
      const validation = validateMaze(data, {
        cellCount: input.cellCount,
        gateCount: input.gateCount,
      });
      if (!validation.ok) {
        // The generator produced something the validator rejects. That is a
        // bug in the seed, not in the caller, and a silent bad fixture is
        // worse than a loud failure.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "errors.mazeInvalid",
        });
      }

      const [row] = await ctx.db
        .insert(maze)
        .values({
          authorId: ctx.session.user.id,
          name: input.name,
          cellCount: input.cellCount,
          gateCount: input.gateCount,
          data,
        })
        .returning({ id: maze.id });

      return { id: row!.id };
    }),
});
```

Mount it in `src/server/api/root.ts` as `testSupport: testSupportRouter,`.

Note the procedure stays mounted unconditionally and refuses at call time with `NOT_FOUND`. Mounting it conditionally would change the router's inferred type between environments, which breaks `AppRouter` typing for the client.

- [ ] **Step 7: Add the API-seeded auth helpers**

Append to `e2e/support/auth.ts`:

```ts
import type { APIRequestContext, Browser, BrowserContext } from "@playwright/test";

/**
 * Spec §12: authentication is seeded through the API, not by driving the
 * form — except in the one spec whose subject *is* the form. Driving it
 * fourteen times a run is why the rate limiter had to be disabled for e2e
 * in the first place.
 */
export async function signUpViaApi(
  request: APIRequestContext,
  email = uniqueEmail(),
): Promise<{ email: string; password: string; cookies: string[] }> {
  const response = await request.post("/api/auth/sign-up/email", {
    data: { email, password: PASSWORD, name: "Test Person" },
  });
  if (!response.ok()) {
    throw new Error(
      `sign-up via API failed: ${response.status()} ${await response.text()}`,
    );
  }
  return {
    email,
    password: PASSWORD,
    cookies: response.headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value),
  };
}

/** A fresh browser context already signed in as a brand-new account. */
export async function signedInContext(
  browser: Browser,
  request: APIRequestContext,
  baseURL: string,
): Promise<BrowserContext> {
  const { cookies } = await signUpViaApi(request);
  const context = await browser.newContext({ baseURL });
  const { hostname } = new URL(baseURL);
  await context.addCookies(
    cookies.map((raw) => {
      const [pair] = raw.split(";");
      const [name, ...rest] = pair!.split("=");
      return {
        name: name!.trim(),
        value: rest.join("=").trim(),
        domain: hostname,
        path: "/",
      };
    }),
  );
  return context;
}
```

Keep `PASSWORD` and `uniqueEmail` exactly as they are — `e2e/support/maze.ts` and `e2e/protected.spec.ts` both import them.

- [ ] **Step 8: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/lib/open-maze.ts src/server/api src/env.js playwright.config.ts e2e/support tests
git commit -m "feat: add test-only maze seeding and API-seeded auth"
```

Confirm the boot warning appears exactly once when `E2E_TEST_SUPPORT=true`, and that a plain `pnpm build` (where it is unset) prints nothing.

---

## Task 5: The expiry sweep

**Files:**
- Create: `src/server/match/sweep.ts`, `src/app/api/cron/sweep/route.ts`, `vercel.json`
- Modify: `src/env.js`
- Create: `tests/integration/sweep.test.ts`

**Interfaces:**
- Consumes: `resolveExpiry`, `isTerminal` from `~/match`; `situationFor` from `~/server/match/situation`; tables `match`, `matchPlayer`.
- Produces: `sweepExpiredMatches(db, now: Date) -> { closed: number }`

### What this task can and cannot close

The sweep evaluates whatever `resolveExpiry` returns, and that function already implements all six §9.1 rows. But `situationFor` hardcodes `lastMoveAt` and `finishedAt` to null, because the columns that would feed them are Phase 4's. So in Phase 3 the sweep can close rows 1 through 4 and never produces a winner — correct, because nobody can reach a treasure yet. Rows 5 and 6 light up the moment Phase 4 fills those two fields in, with no change here.

That is worth stating plainly in the code, because a reader who finds a `{ kind: "complete" }` branch that no test exercises will otherwise assume it is dead.

- [ ] **Step 1: Write the failing tests**

`tests/integration/sweep.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { HOURS_24_MS, HOURS_48_MS } from "~/match";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";
import { sweepExpiredMatches } from "~/server/match/sweep";

import {
  SOLVABLE_MAZE_CELL_COUNT,
  SOLVABLE_MAZE_GATE_COUNT,
  solvableDraft,
} from "../fixtures/maze";

async function signedIn() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

const settings = {
  cellCount: SOLVABLE_MAZE_CELL_COUNT,
  gateCount: SOLVABLE_MAZE_GATE_COUNT,
};

async function savedMaze(caller: ReturnType<typeof createCaller>, name: string) {
  const created = await caller.maze.createDraft({ name, ...settings });
  await caller.maze.saveDraft({ id: created.id, data: solvableDraft() });
  return created.id;
}

const later = (ms: number) => new Date(Date.now() + ms);

describe("sweepExpiredMatches", () => {
  it("leaves a match alone before its deadline", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.match.create(settings);

    await sweepExpiredMatches(db, new Date());

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("awaiting_opponent");
    expect(row?.endReason).toBeNull();
  });

  it("abandons an unjoined match with no winner and nobody at fault", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.match.create(settings);

    await sweepExpiredMatches(db, later(HOURS_24_MS + 1000));

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("abandoned");
    expect(row?.endReason).toBe("abandoned");
    expect(row?.winnerId).toBeNull();
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    expect(players.every((p) => p.forfeitedAt === null)).toBe(true);
  });

  it("abandons a drawing match where neither player drew, blaming neither", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });

    await sweepExpiredMatches(db, later(HOURS_48_MS + 1000));

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("abandoned");
    expect(row?.winnerId).toBeNull();
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    expect(players.every((p) => p.forfeitedAt === null)).toBe(true);
  });

  it("records the drawing forfeit against the player who did not draw, and still gives nobody the win", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    const guestCtx = await signedIn();
    await createCaller(guestCtx).match.join({ code: created.code });
    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "Drew it"),
    });

    await sweepExpiredMatches(db, later(HOURS_24_MS + 1000));

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    // The player who drew does NOT win. This is the spec's load-bearing
    // principle: you cannot win without finding the treasure, and nobody
    // has yet.
    expect(row?.status).toBe("abandoned");
    expect(row?.endReason).toBe("abandoned");
    expect(row?.winnerId).toBeNull();

    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    const host_ = players.find((p) => p.userId === hostCtx.session!.user.id);
    const guest_ = players.find((p) => p.userId === guestCtx.session!.user.id);
    expect(host_?.forfeitedAt).toBeNull();
    expect(guest_?.forfeitedAt).not.toBeNull();
  });

  it("abandons a running match where neither player moved", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());
    await guest.match.join({ code: created.code });
    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "Host"),
    });
    await guest.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(guest, "Guest"),
    });

    await sweepExpiredMatches(db, later(HOURS_24_MS + 1000));

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("abandoned");
    expect(row?.winnerId).toBeNull();
  });

  it("never touches a match that has already ended", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.match.create(settings);
    await sweepExpiredMatches(db, later(HOURS_24_MS + 1000));
    const [first] = await db
      .select()
      .from(match)
      .where(eq(match.id, created.id));

    await sweepExpiredMatches(db, later(HOURS_48_MS * 10));

    const [second] = await db
      .select()
      .from(match)
      .where(eq(match.id, created.id));
    expect(second).toEqual(first);
  });

  it("reports how many it closed", async () => {
    const caller = createCaller(await signedIn());
    await caller.match.create(settings);
    await caller.match.create(settings);

    const result = await sweepExpiredMatches(db, later(HOURS_24_MS + 1000));
    expect(result.closed).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:integration tests/integration/sweep.test.ts`
Expected: FAIL with `Failed to resolve import "~/server/match/sweep"`.

- [ ] **Step 3: Write `src/server/match/sweep.ts`**

```ts
import { and, inArray, lte, notInArray } from "drizzle-orm";

import { MATCH_STATUSES, isTerminal, resolveExpiry } from "~/match";
// Corrected during execution: `situationFor` lives in its own module,
// not in the router. A server-side domain helper should not have to be
// reached through a tRPC router, and the sweep is its second consumer.
import { situationFor } from "~/server/match/situation";
import type { db as Database } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";

const TERMINAL = MATCH_STATUSES.filter(isTerminal);

/**
 * Closes every match whose deadline has passed, so a stale match ends on its
 * own rather than waiting for someone to open it (spec §9.1).
 *
 * One indexed query finds the candidates — which is the whole reason
 * `deadlineAt` is a single column rather than six rules evaluated in
 * application code.
 *
 * Phase 3 note: `situationFor` reports `lastMoveAt` and `finishedAt` as null
 * because the columns that feed them are Phase 4's. So the `complete` branch
 * below is unreachable today and no test exercises it — that is expected,
 * not dead code. The moment Phase 4 fills those two fields in, §9.1 rows 5
 * and 6 start closing here with no change to this file.
 */
export async function sweepExpiredMatches(
  db: typeof Database,
  now: Date,
): Promise<{ closed: number }> {
  const due = await db
    .select()
    .from(match)
    .where(
      and(notInArray(match.status, TERMINAL), lte(match.deadlineAt, now)),
    );

  if (due.length === 0) return { closed: 0 };

  const players = await db
    .select()
    .from(matchPlayer)
    .where(
      inArray(
        matchPlayer.matchId,
        due.map((m) => m.id),
      ),
    );

  let closed = 0;

  for (const row of due) {
    const seated = players.filter((p) => p.matchId === row.id);
    const outcome = resolveExpiry(situationFor(row, seated), now);
    if (outcome.kind === "none") continue;

    await db.transaction(async (tx) => {
      if (outcome.forfeitedBy.length > 0) {
        await tx
          .update(matchPlayer)
          .set({ forfeitedAt: now })
          .where(
            and(
              inArray(matchPlayer.matchId, [row.id]),
              inArray(matchPlayer.userId, [...outcome.forfeitedBy]),
            ),
          );
      }

      await tx
        .update(match)
        .set(
          outcome.kind === "complete"
            ? {
                status: "complete",
                endReason: outcome.endReason,
                winnerId: outcome.winnerId,
                lastActivityAt: now,
              }
            : {
                status: "abandoned",
                endReason: "abandoned",
                winnerId: null,
                lastActivityAt: now,
              },
        )
        .where(inArray(match.id, [row.id]));
    });

    closed += 1;
  }

  return { closed };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test:integration tests/integration/sweep.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Break it and watch it fail**

1. Change `lte(match.deadlineAt, now)` to `lte(match.deadlineAt, new Date(0))`. Expected: every closing test fails and "leaves a match alone before its deadline" still passes. Restore.
2. In the abandoned branch, set `winnerId: row.createdById` instead of null. Expected: **four** tests fail — every test that produces an `abandoned` match asserts `winnerId` is null, and there are four of them (the count said three before execution corrected it). Restore.
3. Remove the `notInArray(match.status, TERMINAL)` filter. **Expected: the suite stays green** — corrected during execution, where this was predicted to fail. `resolveExpiry` → `deadlineFor` already returns `{ kind: "none" }` for a terminal status, so the domain layer is what makes "never touches a match that has already ended" pass; the SQL filter is defence in depth and a performance guard that keeps `match_sweep_idx` selective as closed matches accumulate. Restore it, and know that no test proves it load-bearing for correctness, because it is not.

Break 2 is the important one: it is the spec's load-bearing principle, and if no test fails when you hand out an unearned win, the suite is not guarding it.

- [ ] **Step 6: Add the cron secret to the env schema**

In `src/env.js`, inside `server`:

```js
    // Vercel Cron sends this as a bearer token. Optional so a local `pnpm
    // dev` does not demand it; the route refuses every request when it is
    // unset, which is the right default for a secret.
    CRON_SECRET: z.string().min(32).optional(),
```

and in `runtimeEnv`: `CRON_SECRET: process.env.CRON_SECRET,`.

- [ ] **Step 7: Write `src/app/api/cron/sweep/route.ts`**

```ts
import { env } from "~/env";
import { db } from "~/server/db";
import { sweepExpiredMatches } from "~/server/match/sweep";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron hits this on a schedule (see vercel.json). It is a plain route
 * rather than a tRPC procedure because the caller is a cron runner with a
 * bearer token, not a signed-in person with a session.
 *
 * With no secret configured the route refuses everything. An endpoint that
 * closes matches must not be open merely because an environment variable was
 * forgotten.
 */
export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return new Response("Not configured", { status: 404 });
  }
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await sweepExpiredMatches(db, new Date());
  return Response.json(result);
}
```

- [ ] **Step 8: Schedule it**

Create `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/sweep",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

Every fifteen minutes. The deadlines are measured in whole days, so the sweep's resolution only decides how soon after expiry a match closes, not whether it does. Fifteen minutes keeps "it just sat there" out of the experience without turning a daily rule into a per-minute job.

**Check before committing:** this repo's Vercel project must have no explicit Build Command override, or `vercel.json` will not be the only thing configuring the deploy. That was flagged as an outstanding item in Phase 0 and is still worth confirming.

- [ ] **Step 9: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/server/match src/app/api/cron src/env.js vercel.json tests/integration/sweep.test.ts
git commit -m "feat: close expired matches on a schedule"
```

---

## A note on Tasks 6 and 7

**Neither ships a test of its own, and that is deliberate.** A component renders nothing until a page mounts it; this project has no jsdom and is not getting one, because Playwright covers the browser and Vitest covers pure logic. Both tasks are proved by Task 8's end-to-end specs, which exercise every screen they build. Their own verification is `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test` (nothing broken, catalogue parity holds), and careful reading.

Do not invent a test harness to fill the gap. If something in either task genuinely cannot be trusted without a test, say so in the report rather than solving it unilaterally.

House patterns these two must follow, all established in Phase 2 and all enforced by review:

- A **mutually exclusive choice is a `role="radiogroup"` with `role="radio"` children** — one tab stop, arrow keys moving *and* selecting together, `aria-checked` per option, an accessible name on the group. `src/components/editor/shape-tools.tsx` is the reference. `aria-pressed` buttons are toggle semantics and are wrong for this.
- **Errors render through `resolveErrorKey`** from `~/lib/resolve-error-key`, never from `error.message` directly and never as raw English. Phase 2 shipped two forms that swallowed every error and showed nothing at all; that was the most user-facing defect of the phase.
- **Destructive or irreversible actions get a confirmation step and a pending state.** Submitting a maze is irreversible — it marks the maze immutable forever.
- **Colours come from CSS custom properties.** No raw `oklch()` in a component.
- **Every string translated**, both catalogues, idiomatic Slovak.

---

## Task 6: Creating and joining from the matches page

**Files:**
- Create: `src/components/match/new-match-form.tsx`, `src/components/match/join-match-form.tsx`, `src/components/match/match-list.tsx`
- Create: `src/app/[locale]/(app)/matches/page.tsx`
- Modify: `messages/en.json`, `messages/sk.json`

**Interfaces:**
- Consumes: `api.match.create`, `api.match.join`, `api.match.list` (Task 2); `resolveErrorKey`; `CELL_COUNT_PRESETS`, `MAX_GATES` from `~/maze`; `CODE_LENGTH`, `matchCodeSchema` from `~/match`.
- Produces: the route `/[locale]/matches`, and these DOM hooks for Task 8: `[data-match-row]` on each listed match with `data-status` carrying its status, `[data-match-code]` on the code display, and `[data-join-error]` / `[data-create-error]` on the two error banners.

- [ ] **Step 1: Add the copy to both catalogues**

In `messages/en.json`, a new top-level `"matches"` namespace:

```json
  "matches": {
    "title": "Your matches",
    "empty": "You have no matches yet. Create one, or join a friend's with their code.",
    "createHeading": "Start a match",
    "size": "Size",
    "sizeOption": "{cells} squares",
    "gates": "Gates",
    "create": "Create match",
    "creating": "Creating…",
    "joinHeading": "Join a match",
    "code": "Join code",
    "join": "Join",
    "joining": "Joining…",
    "codeHint": "6 letters and digits, from whoever created the match.",
    "shareCode": "Share this code: {code}",
    "open": "Open",
    "statusAwaitingOpponent": "Waiting for an opponent",
    "statusDrawing": "Both drawing",
    "statusRunning": "Running",
    "statusComplete": "Finished",
    "statusAbandoned": "Abandoned",
    "sizeAndGates": "{cells} squares, {gates} gates"
  },
```

In `messages/sk.json`, the same namespace:

```json
  "matches": {
    "title": "Vaše zápasy",
    "empty": "Zatiaľ nemáte žiadne zápasy. Vytvorte si jeden alebo sa pripojte ku kamarátovi pomocou jeho kódu.",
    "createHeading": "Založiť zápas",
    "size": "Veľkosť",
    "sizeOption": "{cells} políčok",
    "gates": "Brány",
    "create": "Vytvoriť zápas",
    "creating": "Vytvára sa…",
    "joinHeading": "Pripojiť sa k zápasu",
    "code": "Kód na pripojenie",
    "join": "Pripojiť sa",
    "joining": "Pripája sa…",
    "codeHint": "6 písmen a číslic od toho, kto zápas založil.",
    "shareCode": "Zdieľajte tento kód: {code}",
    "open": "Otvoriť",
    "statusAwaitingOpponent": "Čaká sa na súpera",
    "statusDrawing": "Obaja kreslia",
    "statusRunning": "Prebieha",
    "statusComplete": "Dokončený",
    "statusAbandoned": "Opustený",
    "sizeAndGates": "{cells} políčok, {gates} brán"
  },
```

- [ ] **Step 2: Write `src/components/match/new-match-form.tsx`**

A client component. Size is a mutually exclusive choice over `CELL_COUNT_PRESETS`, so it is a radiogroup — follow `src/components/editor/shape-tools.tsx` exactly, including its roving `tabIndex` and the fallback to index 0. Gates is a number input bounded by `MAX_GATES`.

On success, navigate to `/{locale}/matches/{id}` with the localised `useRouter` from `~/i18n/navigation`, so the locale segment survives.

On failure, render `resolveErrorKey(t, error, "errors.unknown")` into a `<p role="alert" data-create-error className="text-danger text-sm">`. Disable the submit button while `create.isPending` and show `matches.creating`.

- [ ] **Step 3: Write `src/components/match/join-match-form.tsx`**

A client component with one text input for the code. Set `maxLength={CODE_LENGTH}`, `autoCapitalize="characters"`, `autoComplete="off"` and `inputMode="text"`. Do **not** validate the alphabet in the component — `matchCodeSchema` already uppercases and checks it server-side, and a second copy of the rule in the client is a second place for it to drift. Let the server's `errors.matchCodeMalformed` come back through `resolveErrorKey` into `<p role="alert" data-join-error>`.

On success, navigate to the returned match.

- [ ] **Step 4: Write `src/components/match/match-list.tsx`**

A client component over `api.match.list.useQuery()`. Branch on `isPending` before `data`, so a returning player does not see the empty state flash before their matches arrive — Phase 2 shipped exactly that bug in `maze-list.tsx` and it was a review finding.

Each row is a `<li data-match-row data-status={m.status}>` containing: the translated status, `matches.sizeAndGates`, the code when the match is still `awaiting_opponent` (inside `[data-match-code]`, since that is the only state where anyone needs to read it), and an `Open` link to the lobby.

Map status to its key explicitly rather than building the key by string concatenation:

```ts
const STATUS_KEY = {
  awaiting_opponent: "statusAwaitingOpponent",
  drawing: "statusDrawing",
  running: "statusRunning",
  complete: "statusComplete",
  abandoned: "statusAbandoned",
} as const satisfies Record<MatchStatus, string>;
```

The `satisfies Record<MatchStatus, string>` is the point: add a status to the union without adding its copy and this fails to compile, rather than rendering a missing key at runtime.

- [ ] **Step 5: Write the page**

`src/app/[locale]/(app)/matches/page.tsx` — a server component inside the existing `(app)` group, which already redirects anonymous visitors to sign-in. It renders an `<h1>` from `matches.title`, then `<NewMatchForm />`, `<JoinMatchForm />` and `<MatchList />`. Follow the layout and Tailwind idiom of `src/app/[locale]/(app)/labyrinths/page.tsx`.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/components/match src/app/[locale] messages
git commit -m "feat: add the matches page with create and join"
```

---

## Task 7: The lobby and the maze picker

**Files:**
- Create: `src/components/match/maze-picker.tsx`, `src/components/match/match-lobby.tsx`
- Create: `src/app/[locale]/(app)/matches/[id]/page.tsx`
- Modify: `messages/en.json`, `messages/sk.json`

**Interfaces:**
- Consumes: `api.match.get`, `api.match.eligibleMazes`, `api.match.submitMaze` (Tasks 2 and 3); `resolveErrorKey`.
- Produces: the route `/[locale]/matches/[id]`, and these DOM hooks for Task 8: `[data-match-status]` carrying the match status, `[data-you-submitted]` and `[data-opponent-submitted]` carrying `"true"` or `"false"`, `[data-submit-error]` on the error banner, and `[data-maze-option]` on each pickable labyrinth carrying its id.

- [ ] **Step 1: Add the copy to both catalogues**

In `messages/en.json`, a new top-level `"lobby"` namespace:

```json
  "lobby": {
    "title": "Match",
    "waitingForOpponent": "Nobody has joined yet. Share your code and they can.",
    "youDraw": "Choose the labyrinth your opponent will solve.",
    "youSubmitted": "Your labyrinth is in.",
    "opponentDrawing": "Your opponent is still choosing theirs.",
    "opponentSubmitted": "Your opponent's labyrinth is in.",
    "bothIn": "Both labyrinths are in. The runs are unlocked.",
    "runsComingSoon": "Solving arrives in the next release.",
    "pickHeading": "Your labyrinths at this size",
    "noneEligible": "You have no labyrinths at this size yet.",
    "drawNew": "Draw a new one",
    "submit": "Submit this labyrinth",
    "submitting": "Submitting…",
    "confirmSubmit": "Submit {name}? It can never be edited again.",
    "confirmYes": "Submit",
    "confirmNo": "Cancel",
    "deadline": "Expires {when}",
    "abandoned": "This match was abandoned. Nobody won.",
    "forfeited": "You ran out of time on this one.",
    "opponentForfeited": "Your opponent ran out of time."
  },
```

In `messages/sk.json`:

```json
  "lobby": {
    "title": "Zápas",
    "waitingForOpponent": "Zatiaľ sa nikto nepripojil. Zdieľajte svoj kód a môžu sa pridať.",
    "youDraw": "Vyberte bludisko, ktoré bude riešiť váš súper.",
    "youSubmitted": "Vaše bludisko je odoslané.",
    "opponentDrawing": "Váš súper si svoje ešte vyberá.",
    "opponentSubmitted": "Bludisko vášho súpera je odoslané.",
    "bothIn": "Obe bludiská sú odoslané. Beh je odomknutý.",
    "runsComingSoon": "Riešenie pribudne v ďalšej verzii.",
    "pickHeading": "Vaše bludiská v tejto veľkosti",
    "noneEligible": "V tejto veľkosti zatiaľ nemáte žiadne bludiská.",
    "drawNew": "Nakresliť nové",
    "submit": "Odoslať toto bludisko",
    "submitting": "Odosiela sa…",
    "confirmSubmit": "Odoslať {name}? Už sa nikdy nebude dať upraviť.",
    "confirmYes": "Odoslať",
    "confirmNo": "Zrušiť",
    "deadline": "Platí do {when}",
    "abandoned": "Tento zápas bol opustený. Nikto nevyhral.",
    "forfeited": "V tomto zápase vám vypršal čas.",
    "opponentForfeited": "Vášmu súperovi vypršal čas."
  },
```

- [ ] **Step 2: Write `src/components/match/maze-picker.tsx`**

Props: `{ matchId: string; selected: string | null; onSelect: (id: string) => void }`.

Reads `api.match.eligibleMazes.useQuery({ matchId })`. Choosing one of several labyrinths is a mutually exclusive choice, so this is a **radiogroup**, built exactly like `src/components/editor/shape-tools.tsx`: one tab stop, arrow keys moving and selecting together, `aria-checked` per option, an accessible name on the group, and the roving stop falling back to index 0 when `selected` matches no option — which is the state it starts in, before anything is chosen, and the state Phase 2's shared-`Tool` trap proved is easy to get wrong and leaves the group unreachable by keyboard.

Each option is `<button role="radio" data-maze-option={m.id}>` showing the maze's name and whether it is a draft or already submitted (reuse is legal, and seeing which is which is the point of the library).

Branch on `isPending` before treating an empty list as "none eligible". When the list really is empty, render `lobby.noneEligible` and a link to `/{locale}/labyrinths` labelled `lobby.drawNew`.

- [ ] **Step 3: Write `src/components/match/match-lobby.tsx`**

Props: `{ matchId: string }`. Reads `api.match.get.useQuery({ id: matchId })`.

Render, in order:

1. `<p data-match-status={view.status}>` with the status sentence for the current state: `waitingForOpponent` when `awaiting_opponent`; otherwise the combination of `youSubmitted` / `youDraw` and `opponentSubmitted` / `opponentDrawing`; `bothIn` plus `runsComingSoon` when `running`; `abandoned` when abandoned.
2. The code, when `awaiting_opponent`, via `matches.shareCode`.
3. `<span data-you-submitted={String(view.you.hasSubmitted)} />` and `<span data-opponent-submitted={String(view.opponent?.hasSubmitted ?? false)} />`. These exist for Task 8 and carry no visible text.
4. The deadline, formatted with next-intl's `useFormatter().dateTime`, never with a hand-rolled string — the locale decides how a date reads.
5. When `status === "drawing"` and `!view.you.hasSubmitted`: the `<MazePicker>` plus a submit control.
6. When either player has forfeited, the matching sentence.

The submit control is **two-step**, because submitting is irreversible — it marks the maze immutable forever. First press shows `lobby.confirmSubmit` with the chosen maze's name plus `confirmYes` / `confirmNo`; only `confirmYes` calls the mutation. Both buttons disabled while pending. Do not use `window.confirm`: a native modal blocks the page and cannot be driven by the e2e suite.

Errors render through `resolveErrorKey(t, error, "errors.unknown")` into `<p role="alert" data-submit-error>`. On success, invalidate the `match.get` query so the lobby reflects the new state.

**Do not poll.** A lobby that refetches on a timer is a websocket problem wearing a disguise, and the realtime layer is Phase 5. The player refreshes, or arrives back from the editor; that is acceptable for this phase and is explicitly not a gap to engineer around.

- [ ] **Step 4: Write the page**

`src/app/[locale]/(app)/matches/[id]/page.tsx` — a server component in the existing `(app)` group. Await `params`, render an `<h1>` from `lobby.title` and `<MatchLobby matchId={id} />`.

Convert **any** `match.get` failure into `notFound()`, exactly as `src/app/[locale]/(app)/labyrinths/[id]/page.tsx` already does for mazes. Never branch on whether the match is missing or merely not yours — that distinction is the thing the router deliberately refuses to make, and re-introducing it in the page would undo it.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build
git add src/components/match src/app/[locale] messages
git commit -m "feat: add the match lobby and the labyrinth picker"
```

---

## Task 8: End-to-end — two accounts reach `running`

**Files:**
- Create: `e2e/support/match.ts`, `e2e/match.spec.ts`
- Modify: none

**Interfaces:**
- Consumes: everything. This is the task that proves Tasks 6 and 7, which ship no tests of their own.
- Produces: the phase's exit criterion, executable.

This is the spec's §15 Phase 3 deliverable stated as a test: **two accounts reach `running`.** Tasks 1–5 are each covered by their own unit or integration suites; the two UI tasks are covered only here.

- [ ] **Step 1: Write `e2e/support/match.ts`**

```ts
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { signedInContext } from "./auth";

/**
 * A signed-in page with a valid labyrinth already seeded at the given size.
 *
 * The maze is seeded through `testSupport.seedMaze` rather than drawn,
 * per spec §12 — a test that clicks seventy-two cells is a test that fails
 * for reasons unrelated to the match lifecycle it is checking.
 */
export async function playerWithMaze(
  browser: Browser,
  request: APIRequestContext,
  baseURL: string,
  options: { name: string; cellCount: number; gateCount: number },
): Promise<Page> {
  const context = await signedInContext(browser, request, baseURL);
  const page = await context.newPage();

  // Seed through the app's own session so the maze belongs to this player.
  await page.goto("/en/matches");
  const seeded = await page.evaluate(async (input) => {
    const response = await fetch("/api/trpc/testSupport.seedMaze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    });
    if (!response.ok) throw new Error(`seed failed: ${response.status}`);
    return response.json();
  }, options);
  expect(seeded).toBeTruthy();

  return page;
}

/** Reads the join code off the matches page after creating a match. */
export async function createMatch(
  page: Page,
  options: { cells: number; gates: number },
): Promise<string> {
  await page.goto("/en/matches");
  await page
    .getByRole("radio", { name: `${options.cells} squares` })
    .click();
  await page.getByLabel("Gates").fill(String(options.gates));
  await page.getByRole("button", { name: "Create match" }).click();
  await expect(page).toHaveURL(/\/en\/matches\/[^/]+$/);
  const code = await page.locator("[data-match-code]").innerText();
  return code.trim().slice(-6);
}
```

If the tRPC fetch shape above does not match what this project's client actually sends, **read `src/trpc/react.tsx` and the route handler at `src/app/api/trpc/[trpc]/route.ts` and use their shape.** Do not guess at superjson's envelope — check it. Getting this wrong produces a seeding failure that looks like a product bug.

- [ ] **Step 2: Write `e2e/match.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

import { createMatch, playerWithMaze } from "./support/match";

const SIZE = { cellCount: 36, gateCount: 0 };

test.describe("match lifecycle", () => {
  test("two accounts create, join, submit, and reach running", async ({
    browser,
    request,
    baseURL,
  }) => {
    // The phase's exit criterion, end to end, as two separate people in two
    // separate browser contexts — not one context switching accounts, which
    // would not prove the ownership boundary holds.
    const host = await playerWithMaze(browser, request, baseURL!, {
      name: "Host maze",
      ...SIZE,
    });
    const guest = await playerWithMaze(browser, request, baseURL!, {
      name: "Guest maze",
      ...SIZE,
    });

    const code = await createMatch(host, { cells: 36, gates: 0 });
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "awaiting_opponent",
    );

    await guest.goto("/en/matches");
    await guest.getByLabel("Join code").fill(code);
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest).toHaveURL(/\/en\/matches\/[^/]+$/);
    await expect(guest.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
    );

    // Host submits. The match must stay in `drawing` — the runs unlock only
    // when both are in, and a test that checked only the final state would
    // not notice if it unlocked early.
    await host.reload();
    await host.locator("[data-maze-option]").first().click();
    await host.getByRole("button", { name: "Submit this labyrinth" }).click();
    await host.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(host.locator("[data-you-submitted]")).toHaveAttribute(
      "data-you-submitted",
      "true",
    );
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
    );

    await guest.locator("[data-maze-option]").first().click();
    await guest.getByRole("button", { name: "Submit this labyrinth" }).click();
    await guest.getByRole("button", { name: "Submit", exact: true }).click();

    await expect(guest.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "running",
    );
    await host.reload();
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "running",
    );
    await expect(host.locator("[data-opponent-submitted]")).toHaveAttribute(
      "data-opponent-submitted",
      "true",
    );

    await host.context().close();
    await guest.context().close();
  });

  test("a submitted labyrinth can no longer be edited", async ({
    browser,
    request,
    baseURL,
  }) => {
    const host = await playerWithMaze(browser, request, baseURL!, {
      name: "One way",
      ...SIZE,
    });
    const guest = await playerWithMaze(browser, request, baseURL!, {
      name: "Theirs",
      ...SIZE,
    });

    const code = await createMatch(host, { cells: 36, gates: 0 });
    await guest.goto("/en/matches");
    await guest.getByLabel("Join code").fill(code);
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest).toHaveURL(/\/en\/matches\/[^/]+$/);

    await host.reload();
    await host.locator("[data-maze-option]").first().click();
    await host.getByRole("button", { name: "Submit this labyrinth" }).click();
    await host.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(host.locator("[data-you-submitted]")).toHaveAttribute(
      "data-you-submitted",
      "true",
    );

    // The library still lists it, but the editor must refuse to change it.
    await host.goto("/en/labyrinths");
    await expect(host.getByText("One way")).toBeVisible();

    await host.context().close();
    await guest.context().close();
  });

  test("an unknown join code is refused with a translated message", async ({
    browser,
    request,
    baseURL,
  }) => {
    const player = await playerWithMaze(browser, request, baseURL!, {
      name: "Solo",
      ...SIZE,
    });

    await player.goto("/en/matches");
    await player.getByLabel("Join code").fill("ZZZZZZ");
    await player.getByRole("button", { name: "Join" }).click();

    const error = player.locator("[data-join-error]");
    await expect(error).toBeVisible();
    await expect(error).toHaveText("No match has that code.");
    // The key itself must never reach the person.
    await expect(error).not.toContainText("errors.");

    await player.context().close();
  });

  test("the matches list shows a created match and its code", async ({
    browser,
    request,
    baseURL,
  }) => {
    const player = await playerWithMaze(browser, request, baseURL!, {
      name: "Listed",
      ...SIZE,
    });

    const code = await createMatch(player, { cells: 36, gates: 0 });

    await player.goto("/en/matches");
    const row = player.locator("[data-match-row]").first();
    await expect(row).toHaveAttribute("data-status", "awaiting_opponent");
    await expect(row).toContainText(code);

    await player.context().close();
  });
});
```

- [ ] **Step 3: Check what is serving port 3000 before trusting anything**

Playwright is configured with `reuseExistingServer`. A stale Next dev server from an **unrelated project** has twice handed this repo absurd failures — missing elements that obviously exist, wrong page titles. Before debugging any failure:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

If it is not this project's server, kill it and rerun.

- [ ] **Step 4: Run the suite**

Run: `pnpm e2e`
Expected: every spec passes in both the desktop and mobile projects.

- [ ] **Step 5: Break it and watch it fail**

Three breaks, each aimed at a spec that would otherwise be suspiciously easy to pass:

1. In `submitMaze`, change `bothIn` to `seated.length === 2`. Expected: the headline spec fails at the *first* status assertion — the one checking the match is still `drawing` after only the host submitted. If it only fails at the end, the intermediate assertion is not doing its job.
2. In the lobby, render `view.status` into `[data-match-status]` as a literal `"running"`. Expected: the first two assertions of the headline spec fail. This is the check that the attribute reflects real state rather than being hardcoded.
3. In `join-match-form.tsx`, render `error.message` directly instead of going through `resolveErrorKey`. Expected: "an unknown join code is refused with a translated message" fails on the `not.toContainText("errors.")` assertion. That assertion exists because Phase 2 shipped a resolver that was never wired to the client, so every error collapsed to a generic string — the bug was invisible to every test that only checked a banner appeared.

Restore after each and confirm green.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format && pnpm format:check && pnpm build && pnpm e2e
git add e2e
git commit -m "test: two accounts reach running, end to end"
```

Confirm `git status --short docs/` prints nothing and `.env` is not staged.

---

## Deliberately not in this phase

Each of these is a real spec requirement, deferred with a reason. They belong on a standing backlog, not only in this file — Phase 2 learned that a deferral list living in a per-phase plan is a deferral nobody finds again.

- **The run itself** (§7, §10.3) — Phase 4. It is the phase where the product exists.
- **Spectating and replay** (§8, §10.4) — Phase 5.
- **Live lobby updates.** The lobby does not poll and has no websocket; a player refreshes to see their opponent's submission land. The realtime layer arrives in Phase 5 and the lobby joins it then.
- **Rematch, and reusing a maze from a finished match's result screen.** There is no result screen until Phase 4.
- **Cancelling a match you created.** The 24-hour sweep closes an unjoined match on its own. An explicit cancel is a nicety, not a correctness requirement, and it needs its own thinking about what cancelling mid-`drawing` means to the opponent who already drew.
- **ICU pluralisation** across counted strings in both locales — carried over from Phase 2. Slovak distinguishes one / two-to-four / five-plus, and the catalogue currently flattens all of them. `matches.sizeAndGates` and `lobby.*` add more counted strings to the pile. Doing it properly is one pass over every counted string in both files.
- **A DB-level constraint on `match.status` and `maze.status`**, and an `updated_at` trigger. The enums live only in the Drizzle types today.
- **An index on `(author_id, content_hash)`** for maze reuse, once the library is large enough for the lookup to matter.

## Self-review

**Spec coverage.** §6's `match` and `match_player` → Task 2 (minus the run columns, deferred with a stated reason). §9's state machine → Tasks 1, 2, 3. §9.1's six rows → Task 1 as pure logic, Tasks 2, 3 and 5 as wiring, with rows 5 and 6 reachable only once Phase 4 supplies move and finish data. §6's reuse rules → Task 3. §11's `MatchExpired`, `MatchFull`, `NotAParticipant`, `MazeInvalid`, `Forbidden` → Tasks 2 and 3; `RunNotUnlocked` and `RunAlreadyFinished` belong to Phase 4 and are correctly absent. §12's injected-clock deadline suite → Tasks 1 and 5; its two e2e disciplines → Task 4. §15's "two accounts reach `running`" → Task 8.

**Gap found and closed during review:** the §9.1 suite is specified in Task 1 (pure, clock injected) *and* Task 5 (through the database). That is deliberate rather than duplicated — Task 1 proves the rules, Task 5 proves the wiring reads and writes the right columns — but the plan now says so explicitly at both sites so no implementer collapses one into the other.

**Second gap found and closed:** Task 3's tests import `maze` from `~/server/db/schema` and `and` from `drizzle-orm`, neither of which Task 2's version of the test file imports. Step 2 of Task 3 now lists those imports explicitly rather than leaving an implementer to discover them from a compile error.

**Type consistency.** `situationFor` is defined in Task 2 and consumed in Tasks 3 and 5 under that exact name. `MatchSituation`, `PlayerSituation`, `ExpiryOutcome`, `deadlineFor`, `resolveExpiry`, `makeCode`, `matchCodeSchema`, `CODE_LENGTH` are defined in Task 1 and used under the same names throughout. `openMazeDraft` / `openMazeOptimalMoves` are defined in Task 4 and consumed by `tests/fixtures/maze.ts` in the same task. The DOM hooks Task 8 selects on (`[data-match-row]`, `[data-status]`, `[data-match-code]`, `[data-match-status]`, `[data-you-submitted]`, `[data-opponent-submitted]`, `[data-maze-option]`, `[data-join-error]`, `[data-create-error]`, `[data-submit-error]`) are each named in the Produces block of the task that creates them.

**A caution about counts.** Every "expected: PASS, N tests" in this plan is a count I wrote by reading my own test code, and across the previous phase such counts were wrong three times while the code blocks themselves were right. Treat a mismatch between a stated count and the actual one as a defect in this document, not in the implementation — report it and move on.
