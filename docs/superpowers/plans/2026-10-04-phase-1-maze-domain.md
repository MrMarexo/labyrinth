# Labyrinth Phase 1 — Maze Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure game domain — the maze format, its validator, the
key-aware solver and the move reducer — as framework-free functions over plain
data, proved by example and property tests.

**Architecture:** Everything lives in `src/maze/` and imports nothing from Next,
React, tRPC, Drizzle or Node. The same four modules run in three places: the
server as the authority on every move, the live spectator view, and the replay
view — and later a mobile client. That is why purity is enforced by ESLint
rather than asked for politely. This phase ships no UI and no routes; its
deliverable is a tested library plus the one piece of plumbing the validator
needs to report failures in a translatable way.

**Tech Stack:** TypeScript strict, zod (already installed), `fast-check` for
property tests, Vitest in a Node environment. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-22-labyrinth-design.md` — sections 2
(rules), 3 (format), 4 (validation) and 12 (testing) are what this phase
implements. Read them; this plan argues from them.

## Global Constraints

Copied from the spec and from `AGENTS.md`. Exact values are exact.

- **`src/maze/` imports nothing** from Next, React, tRPC, Drizzle, Better Auth,
  next-intl, or Node builtins. ESLint enforces it. If a rule blocks something
  you believe you need, stop and report — do not weaken the rule.
- **Validation failures travel as i18n message keys with parameters, never as
  English strings.** This phase defines the mechanism.
- **A void-blocked move must be indistinguishable from a wall-blocked move** in
  everything the runner receives. Server-side they are distinct values; what
  reaches the runner must be byte-for-byte identical. A property test asserts it.
- **Edge addressing**, with `y` increasing downward: `{o:"H",x,y}` is the edge
  between `(x,y)` and `(x,y+1)`; `{o:"V",x,y}` is the edge between `(x,y)` and
  `(x+1,y)`. Every edge has exactly one legal spelling.
- **Limits:** `cellCount` presets 36, 64, 100, 144. `gateCount` 0–8. Bounding
  box at most 16 × 16. No minimum shape size.
- **Only the treasure must be reachable** — not every cell. Sealed pockets and
  decorative gates, including gates whose keys are unreachable, are legal.
- Node 24, pnpm 11. TypeScript strict plus `noUncheckedIndexedAccess`. No `any`.
- Every task ends with a commit in Conventional Commits format, ending with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

```
src/lib/issues.ts          TranslatableIssue type + zod → issues mapping (not maze-specific)
src/maze/format.ts         zod schema, inferred types, constants, error map
src/maze/geometry.ts       edge addressing and neighbour arithmetic
src/maze/normalize.ts      translate-to-origin, canonical ordering, content hash
src/maze/validate.ts       the eleven structural rules from spec §4.1
src/maze/solve.ts          (cell, keysHeld) search; solvability and optimalMoves
src/maze/reduce.ts         the move reducer and its runner-facing delta
src/maze/index.ts          public barrel
```

Tests sit in `tests/unit/maze/` mirroring those names, except `geometry.ts`
whose behaviour is covered through its callers.

---

### Task 1: The translatable-error contract, and the groundwork

**Files:**
- Create: `src/lib/issues.ts`
- Modify: `src/server/api/trpc.ts`
- Modify: `eslint.config.js`
- Modify: `src/server/auth/index.ts`
- Modify: `AGENTS.md`, `.github/workflows/ci.yml`
- Test: `tests/unit/issues.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TranslatableIssue` (`{ key: string; params?: Record<string, string | number>; path?: (string | number)[] }`) and `toTranslatableIssues(cause: unknown): TranslatableIssue[]`, both from `~/lib/issues`. Every later task reports failures as `TranslatableIssue[]`.

The spec states this contract in §10.6 and §11, the Global Constraints repeat
it, and `AGENTS.md` invariant 3 asserts it — but nothing implements it. The
tRPC error formatter is still the scaffold's, passing raw English zod messages
straight to the client. Phase 1's validator is the first thing that will
produce real validation failures, so the contract gets built here, against a
real consumer, rather than invented in the abstract later.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/issues.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toTranslatableIssues } from "~/lib/issues";

describe("toTranslatableIssues", () => {
  it("turns a zod error into keyed issues, preserving the path", () => {
    const schema = z.object({
      width: z.number().int({ message: "maze.format.notAnInteger" }),
    });
    const result = schema.safeParse({ width: 1.5 });
    expect(result.success).toBe(false);

    expect(toTranslatableIssues(result.error)).toEqual([
      { key: "maze.format.notAnInteger", path: ["width"] },
    ]);
  });

  it("carries params from a custom issue", () => {
    const schema = z.number().superRefine((value, ctx) => {
      if (value < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "maze.format.tooSmall",
          params: { min: 10 },
        });
      }
    });
    const result = schema.safeParse(3);
    expect(result.success).toBe(false);

    expect(toTranslatableIssues(result.error)).toEqual([
      { key: "maze.format.tooSmall", params: { min: 10 }, path: [] },
    ]);
  });

  it("replaces an English zod default with a generic key", () => {
    // No message override, so zod supplies English prose. That must never
    // reach the client — it is untranslatable and leaks implementation detail.
    const result = z.string().safeParse(42);
    expect(result.success).toBe(false);

    const issues = toTranslatableIssues(result.error);
    expect(issues).toEqual([{ key: "errors.validation.invalid", path: [] }]);
  });

  it("returns an empty list for a non-zod cause", () => {
    expect(toTranslatableIssues(new Error("boom"))).toEqual([]);
    expect(toTranslatableIssues(undefined)).toEqual([]);
  });
});
```

The third test is the one that matters. It is what stops English prose leaking
the day someone adds a schema and forgets a message.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/issues.test.ts`

Expected: FAIL — `Failed to resolve import "~/lib/issues"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/issues.ts`:

```ts
import { ZodError, type ZodIssue } from "zod";

/**
 * A validation failure expressed as a message key plus its interpolation
 * parameters. Never an English sentence: the client translates it, and the
 * same issue must read correctly in English and Slovak.
 */
export type TranslatableIssue = {
  key: string;
  params?: Record<string, string | number>;
  path?: (string | number)[];
};

/** A key looks like `namespace.some.key` — lowercase start, dot-separated. */
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;

const FALLBACK_KEY = "errors.validation.invalid";

function issueToTranslatable(issue: ZodIssue): TranslatableIssue {
  // A schema that set no message gets zod's English default. We refuse to
  // forward it — a generic key is worse copy but it is translatable, and the
  // unit test for this behaviour is what keeps schemas honest.
  const key = KEY_SHAPE.test(issue.message) ? issue.message : FALLBACK_KEY;

  const params =
    issue.code === "custom" && issue.params
      ? (issue.params as Record<string, string | number>)
      : undefined;

  return params
    ? { key, params, path: issue.path }
    : { key, path: issue.path };
}

export function toTranslatableIssues(cause: unknown): TranslatableIssue[] {
  if (!(cause instanceof ZodError)) return [];
  return cause.issues.map(issueToTranslatable);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/unit/issues.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Surface issues through tRPC instead of the raw zod error**

In `src/server/api/trpc.ts`, replace the `errorFormatter` body. The existing
one returns `zodError: error.cause instanceof ZodError ? error.cause.flatten() : null`,
which is a bag of English strings.

```ts
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        issues: toTranslatableIssues(error.cause),
      },
    };
  },
```

Add `import { toTranslatableIssues } from "~/lib/issues";` and remove the now
unused `ZodError` import if nothing else uses it.

- [ ] **Step 6: Close the module-boundary gap left open in Phase 0**

In `eslint.config.js`, the `src/maze/**` restricted group bans `node:*` plus the
bare specifiers `fs`, `path` and `crypto`. Bare `os`, `child_process`, `stream`,
`buffer` and `util` still pass. Replace those four entries with one pattern that
covers both spellings and any subpath:

```js
            "node:*",
            "fs",
            "fs/*",
            "path",
            "path/*",
            "crypto",
            "os",
            "stream",
            "stream/*",
            "buffer",
            "util",
            "child_process",
```

- [ ] **Step 7: Mark the auth module server-only**

`src/server/auth/index.ts` now imports `cache` from `react`. In a client bundle
that would fail at runtime rather than at build time. Add as the first line:

```ts
import "server-only";
```

`server-only` is already a dependency from the scaffold.

- [ ] **Step 8: Fix three stale documentation lines**

1. `.github/workflows/ci.yml` — the comment above `SKIP_ENV_VALIDATION` says it
   is needed because "`next lint` loads next.config.js". Phase 0 replaced
   `next lint` with `eslint .`, which does not. Keep the variable, correct the
   reason: it is needed because other steps in this job import `~/env`.
2. `AGENTS.md` — the line claiming `DATABASE_URL_UNPOOLED` "must be present in
   every Vercel environment scope … not optional there the way it looks
   locally" reads as a new requirement of `vercel-build`. It is not; `src/env.js`
   already required it. Reword to say `vercel-build` changes *when* a missing
   value fails, not *whether*.
3. `AGENTS.md`, under the migrations section — add two sentences: concurrent
   `vercel-build` runs against one database are not locked, so one deploy's
   migration commits and the other rolls back and fails; and Vercel's instant
   rollback does not re-run `vercel-build`, so a rollback serves old code
   against the new schema. Both are contained by the expand-then-contract rule
   already documented.

- [ ] **Step 9: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
git add -A
git commit -m "$(cat <<'MSG'
feat: report validation failures as translatable issues

The spec, the plan's constraints and AGENTS.md all asserted that validation
errors travel as i18n keys; nothing implemented it. The tRPC formatter now
emits keyed issues with params, and a zod schema that forgets a message gets a
generic key rather than leaking English prose.

Also closes the src/maze builtin-import gap, marks the auth module server-only,
and corrects three stale documentation lines.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The maze format

**Files:**
- Create: `src/maze/format.ts`
- Test: `tests/unit/maze/format.test.ts`
- Modify: `package.json` (add `fast-check`)

**Interfaces:**
- Consumes: `TranslatableIssue`, `toTranslatableIssues` (Task 1).
- Produces, all from `~/maze/format`:
  - constants `MAX_BOUNDING_BOX = 16`, `MAX_GATES = 8`, `CELL_COUNT_PRESETS`
  - types `Point`, `Orientation` (`"H" | "V"`), `Direction` (`"N" | "E" | "S" | "W"`), `Segment`, `MazeKey`, `Maze`
  - `DIRECTIONS` and `ORIENTATIONS` as readonly tuples
  - `mazeSchema` (zod) and `parseMaze(input: unknown): { ok: true; maze: Maze } | { ok: false; issues: TranslatableIssue[] }`

- [ ] **Step 1: Install fast-check**

```bash
pnpm add -D fast-check
```

This phase is the first to need property tests; spec §12 requires them.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/maze/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseMaze } from "~/maze/format";

/** The smallest maze that satisfies the schema: two cells side by side. */
const minimal = {
  version: 1,
  cells: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
  start: { x: 0, y: 0 },
  treasure: { x: 1, y: 0 },
  segments: [],
  keys: [],
};

describe("parseMaze", () => {
  it("accepts a well-formed maze", () => {
    const result = parseMaze(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.maze.cells).toHaveLength(2);
  });

  it("accepts walls and matched gate/key pairs", () => {
    const result = parseMaze({
      ...minimal,
      segments: [
        { o: "H", x: 0, y: 0, kind: "wall" },
        { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
      ],
      keys: [{ gate: 1, x: 1, y: 0 }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown version", () => {
    const result = parseMaze({ ...minimal, version: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toContain(
        "maze.format.unknownVersion",
      );
    }
  });

  it("rejects a gate segment with no gate id", () => {
    const result = parseMaze({
      ...minimal,
      segments: [{ o: "H", x: 0, y: 0, kind: "gate" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a gate id above the cap", () => {
    const result = parseMaze({
      ...minimal,
      segments: [{ o: "H", x: 0, y: 0, kind: "gate", gate: 9 }],
      keys: [{ gate: 9, x: 1, y: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toContain(
        "maze.format.gateIdOutOfRange",
      );
    }
  });

  it("rejects a coordinate outside the bounding box", () => {
    const result = parseMaze({
      ...minimal,
      cells: [
        { x: 0, y: 0 },
        { x: 16, y: 0 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toContain(
        "maze.format.coordinateOutOfRange",
      );
    }
  });

  it("rejects a non-integer coordinate", () => {
    const result = parseMaze({ ...minimal, start: { x: 0.5, y: 0 } });
    expect(result.ok).toBe(false);
  });

  it("never produces an English message", () => {
    // Every issue must be a key. This is the guard that keeps the i18n
    // contract true as the schema grows.
    for (const bad of [
      { ...minimal, version: 99 },
      { ...minimal, cells: [] },
      { ...minimal, start: { x: -1, y: 0 } },
      { ...minimal, keys: [{ gate: 0, x: 0, y: 0 }] },
      "not an object",
      null,
    ]) {
      const result = parseMaze(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        for (const issue of result.issues) {
          expect(issue.key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/);
          expect(issue.key).not.toMatch(/\s/);
        }
      }
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test tests/unit/maze/format.test.ts`

Expected: FAIL — `Failed to resolve import "~/maze/format"`.

- [ ] **Step 4: Write the implementation**

One thing to verify rather than assume as you go: this code passes
`{ message: "..." }` to several zod factories. Zod 3.25 accepts it on checks
like `.int()`, `.min()` and `.max()`, and on `RawCreateParams` for `z.literal`.
If any call is rejected by the type checker, use
`{ errorMap: () => ({ message: "the.key" }) }` instead and note it in your
report — do not fall back to a bare English message.

Create `src/maze/format.ts`:

```ts
import { z } from "zod";

import { toTranslatableIssues, type TranslatableIssue } from "~/lib/issues";

/** Spec §3.3. The cap is set by what fits a desktop board, not by storage. */
export const MAX_BOUNDING_BOX = 16;

/** Spec §3.3. Keeps the solver's state space at cells × 2^8. */
export const MAX_GATES = 8;

/** Spec §3.3. The author paints exactly this many cells. */
export const CELL_COUNT_PRESETS = [36, 64, 100, 144] as const;
export type CellCount = (typeof CELL_COUNT_PRESETS)[number];

export const ORIENTATIONS = ["H", "V"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const DIRECTIONS = ["N", "E", "S", "W"] as const;
export type Direction = (typeof DIRECTIONS)[number];

const coordinate = z
  .number()
  .int({ message: "maze.format.coordinateNotAnInteger" })
  .min(0, { message: "maze.format.coordinateOutOfRange" })
  .max(MAX_BOUNDING_BOX - 1, { message: "maze.format.coordinateOutOfRange" });

const pointSchema = z.object({ x: coordinate, y: coordinate });
export type Point = z.infer<typeof pointSchema>;

const gateId = z
  .number()
  .int({ message: "maze.format.gateIdNotAnInteger" })
  .min(1, { message: "maze.format.gateIdOutOfRange" })
  .max(MAX_GATES, { message: "maze.format.gateIdOutOfRange" });

// Plain z.enum: an invalid orientation falls through to the generic
// `errors.validation.invalid` key, which is acceptable because the editor
// cannot produce one — only hand-edited or corrupted input can.
const orientation = z.enum(ORIENTATIONS);

const segmentSchema = z.discriminatedUnion("kind", [
  z.object({
    o: orientation,
    x: coordinate,
    y: coordinate,
    kind: z.literal("wall"),
  }),
  z.object({
    o: orientation,
    x: coordinate,
    y: coordinate,
    kind: z.literal("gate"),
    gate: gateId,
  }),
]);
export type Segment = z.infer<typeof segmentSchema>;

const keySchema = z.object({ gate: gateId, x: coordinate, y: coordinate });
export type MazeKey = z.infer<typeof keySchema>;

export const mazeSchema = z.object({
  version: z.literal(1, { message: "maze.format.unknownVersion" }),
  cells: z
    .array(pointSchema)
    .min(1, { message: "maze.format.noCells" }),
  start: pointSchema,
  treasure: pointSchema,
  segments: z.array(segmentSchema),
  keys: z.array(keySchema),
});

export type Maze = z.infer<typeof mazeSchema>;

export type ParseResult =
  | { ok: true; maze: Maze }
  | { ok: false; issues: TranslatableIssue[] };

/**
 * Parses untrusted input into a Maze. This is shape only — the eleven
 * structural rules in spec §4.1 and the solvability search in §4.2 are
 * separate passes, because they need the match's settings and this does not.
 */
export function parseMaze(input: unknown): ParseResult {
  const result = mazeSchema.safeParse(input);
  if (result.success) return { ok: true, maze: result.data };
  return { ok: false, issues: toTranslatableIssues(result.error) };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tests/unit/maze/format.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 6: Verify the boundary rule actually covers this file**

The ESLint purity rule is the reason `src/maze/` exists as a separate
directory. Prove it is live now that the directory has real code:

```bash
cat > src/maze/boundary-probe.ts <<'PROBE'
import { useState } from "react";
export const probe = useState;
PROBE
pnpm lint 2>&1 | grep -q "src/maze must stay pure" && echo "RULE FIRES" || echo "RULE DID NOT FIRE"
rm src/maze/boundary-probe.ts
```

Expected: `RULE FIRES`. Then confirm `git status` is clean of the probe.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
git add -A
git commit -m "$(cat <<'MSG'
feat: add the maze format schema

Edge-addressed segments, matched gate/key ids, and coordinates bounded by the
16x16 cap. Every zod message is an i18n key, with a test asserting no English
prose can escape the parser.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Geometry, normalization and the content hash

**Files:**
- Create: `src/maze/geometry.ts`, `src/maze/normalize.ts`
- Test: `tests/unit/maze/normalize.test.ts`

**Interfaces:**
- Consumes: `Maze`, `Point`, `Segment`, `Direction`, `Orientation` (Task 2).
- Produces:
  - from `~/maze/geometry`: `step(point: Point, dir: Direction): Point`;
    `edgeBetween(from: Point, dir: Direction): { o: Orientation; x: number; y: number }`;
    `cellKey(p: Point): string`; `edgeKey(e: { o: Orientation; x: number; y: number }): string`
  - from `~/maze/normalize`: `normalize(maze: Maze): Maze`; `canonicalString(maze: Maze): string`; `contentHash(maze: Maze): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/maze/normalize.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Maze } from "~/maze/format";
import { canonicalString, contentHash, normalize } from "~/maze/normalize";

const maze: Maze = {
  version: 1,
  cells: [
    { x: 3, y: 2 },
    { x: 4, y: 2 },
    { x: 3, y: 3 },
  ],
  start: { x: 3, y: 2 },
  treasure: { x: 3, y: 3 },
  segments: [{ o: "V", x: 3, y: 2, kind: "wall" }],
  keys: [],
};

/** Moves every coordinate by (dx, dy) without changing the maze's meaning. */
function translate(m: Maze, dx: number, dy: number): Maze {
  const move = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...m,
    cells: m.cells.map(move),
    start: move(m.start),
    treasure: move(m.treasure),
    segments: m.segments.map((s) => ({ ...s, ...move(s) })),
    keys: m.keys.map((k) => ({ ...k, ...move(k) })),
  };
}

describe("normalize", () => {
  it("translates the shape so its bounding box starts at the origin", () => {
    const n = normalize(maze);
    expect(Math.min(...n.cells.map((c) => c.x))).toBe(0);
    expect(Math.min(...n.cells.map((c) => c.y))).toBe(0);
    expect(n.start).toEqual({ x: 0, y: 0 });
    expect(n.treasure).toEqual({ x: 0, y: 1 });
  });

  it("orders cells, segments and keys deterministically", () => {
    const shuffled: Maze = {
      ...maze,
      cells: [maze.cells[2]!, maze.cells[0]!, maze.cells[1]!],
    };
    expect(canonicalString(normalize(shuffled))).toBe(
      canonicalString(normalize(maze)),
    );
  });
});

describe("contentHash", () => {
  it("is stable under translation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 12 }),
        (dx, dy) => {
          expect(contentHash(translate(maze, dx, dy))).toBe(contentHash(maze));
        },
      ),
    );
  });

  it("is stable under reordering", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(maze.cells, { minLength: 3 }), (cells) => {
        expect(contentHash({ ...maze, cells })).toBe(contentHash(maze));
      }),
    );
  });

  it("changes when a wall moves", () => {
    const moved: Maze = {
      ...maze,
      segments: [{ o: "H", x: 3, y: 2, kind: "wall" }],
    };
    expect(contentHash(moved)).not.toBe(contentHash(maze));
  });

  it("changes when a wall becomes a gate", () => {
    const gated: Maze = {
      ...maze,
      segments: [{ o: "V", x: 3, y: 2, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 4, y: 2 }],
    };
    expect(contentHash(gated)).not.toBe(contentHash(maze));
  });

  it("is a fixed-width lowercase hex string", () => {
    expect(contentHash(maze)).toMatch(/^[0-9a-f]{16}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/maze/normalize.test.ts`

Expected: FAIL — cannot resolve `~/maze/normalize`.

- [ ] **Step 3: Write the geometry helpers**

Create `src/maze/geometry.ts`:

```ts
import type { Direction, Orientation, Point } from "./format";

export type Edge = { o: Orientation; x: number; y: number };

/** The cell one step from `point` in `dir`. y increases downward (spec §3.1). */
export function step(point: Point, dir: Direction): Point {
  switch (dir) {
    case "N":
      return { x: point.x, y: point.y - 1 };
    case "S":
      return { x: point.x, y: point.y + 1 };
    case "W":
      return { x: point.x - 1, y: point.y };
    case "E":
      return { x: point.x + 1, y: point.y };
  }
}

/**
 * The single legal spelling of the edge crossed when leaving `from` in `dir`.
 * Each interior edge has exactly one name, which is what makes a duplicate a
 * validation error rather than a silent disagreement between two copies.
 */
export function edgeBetween(from: Point, dir: Direction): Edge {
  switch (dir) {
    case "N":
      return { o: "H", x: from.x, y: from.y - 1 };
    case "S":
      return { o: "H", x: from.x, y: from.y };
    case "W":
      return { o: "V", x: from.x - 1, y: from.y };
    case "E":
      return { o: "V", x: from.x, y: from.y };
  }
}

export function cellKey(p: Point): string {
  return `${p.x},${p.y}`;
}

export function edgeKey(e: Edge): string {
  return `${e.o}:${e.x},${e.y}`;
}
```

- [ ] **Step 4: Write normalization and hashing**

Create `src/maze/normalize.ts`:

```ts
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
  const shift = <T extends Point>(p: T): T => ({ ...p, x: p.x - dx, y: p.y - dy });

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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tests/unit/maze/normalize.test.ts`

Expected: PASS, 7 tests.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
git add -A
git commit -m "$(cat <<'MSG'
feat: add maze geometry, normalization and content hashing

Edge addressing has one legal spelling per edge. Normalization translates to
the origin and sorts canonically, so the same labyrinth drawn anywhere on the
canvas hashes identically — proved by property tests over translation and
reordering.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Structural validation

**Files:**
- Create: `src/maze/validate.ts`
- Test: `tests/unit/maze/validate.test.ts`

**Interfaces:**
- Consumes: `Maze`, `MAX_BOUNDING_BOX`, `MAX_GATES` (Task 2); `cellKey`, `edgeKey` (Task 3); `TranslatableIssue` (Task 1).
- Produces: `MazeSettings` (`{ cellCount: number; gateCount: number }`) and `validateStructure(maze: Maze, settings: MazeSettings): TranslatableIssue[]`, from `~/maze/validate`. An empty array means structurally valid.

This implements the eleven rules in spec §4.1. Solvability is Task 5 — it is a
separate pass because it is a search rather than a check, and because the
editor can usefully show structural problems before a maze is solvable.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/maze/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Maze } from "~/maze/format";
import { validateStructure } from "~/maze/validate";

/** A 2x2 block of four cells, no segments. */
function square(): Maze {
  return {
    version: 1,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    start: { x: 0, y: 0 },
    treasure: { x: 1, y: 1 },
    segments: [],
    keys: [],
  };
}

const settings = { cellCount: 4, gateCount: 0 };

function keys(maze: Maze, s = settings): string[] {
  return validateStructure(maze, s).map((i) => i.key);
}

describe("validateStructure", () => {
  it("accepts a valid maze", () => {
    expect(validateStructure(square(), settings)).toEqual([]);
  });

  it("rejects a cell count that does not match the match setting", () => {
    expect(keys(square(), { cellCount: 36, gateCount: 0 })).toContain(
      "maze.validate.wrongCellCount",
    );
  });

  it("reports the expected and actual counts as params", () => {
    const issue = validateStructure(square(), { cellCount: 36, gateCount: 0 })
      .find((i) => i.key === "maze.validate.wrongCellCount");
    expect(issue?.params).toEqual({ expected: 36, actual: 4 });
  });

  it("rejects duplicate cells", () => {
    const maze = square();
    maze.cells[1] = { x: 0, y: 0 };
    expect(keys(maze)).toContain("maze.validate.duplicateCell");
  });

  it("rejects a disconnected shape", () => {
    const maze = square();
    maze.cells[3] = { x: 5, y: 5 };
    maze.treasure = { x: 5, y: 5 };
    expect(keys(maze)).toContain("maze.validate.disconnectedShape");
  });

  it("rejects a start that is not a painted cell", () => {
    const maze = square();
    maze.start = { x: 9, y: 9 };
    expect(keys(maze)).toContain("maze.validate.startNotInShape");
  });

  it("rejects a treasure that is not a painted cell", () => {
    const maze = square();
    maze.treasure = { x: 9, y: 9 };
    expect(keys(maze)).toContain("maze.validate.treasureNotInShape");
  });

  it("rejects start and treasure on the same cell", () => {
    const maze = square();
    maze.treasure = { ...maze.start };
    expect(keys(maze)).toContain("maze.validate.startIsTreasure");
  });

  it("rejects a key on the start cell", () => {
    const maze = square();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }];
    maze.keys = [{ gate: 1, x: 0, y: 0 }];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.keyOnStart",
    );
  });

  it("rejects two keys on one cell", () => {
    const maze = square();
    maze.segments = [
      { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
      { o: "V", x: 0, y: 1, kind: "gate", gate: 2 },
    ];
    maze.keys = [
      { gate: 1, x: 1, y: 0 },
      { gate: 2, x: 1, y: 0 },
    ];
    expect(keys(maze, { cellCount: 4, gateCount: 2 })).toContain(
      "maze.validate.cellHoldsTwoThings",
    );
  });

  it("rejects a bounding box wider than the cap", () => {
    const maze = square();
    maze.cells = [{ x: 0, y: 0 }];
    for (let x = 1; x < 17; x += 1) maze.cells.push({ x, y: 0 });
    maze.treasure = { x: 16, y: 0 };
    expect(keys(maze, { cellCount: 17, gateCount: 0 })).toContain(
      "maze.validate.boundingBoxTooLarge",
    );
  });

  it("rejects a segment whose neighbour is not painted", () => {
    const maze = square();
    // The south edge of (0,1) faces a void square.
    maze.segments = [{ o: "H", x: 0, y: 1, kind: "wall" }];
    expect(keys(maze)).toContain("maze.validate.segmentOutsideShape");
  });

  it("rejects two segments on the same edge", () => {
    const maze = square();
    maze.segments = [
      { o: "V", x: 0, y: 0, kind: "wall" },
      { o: "V", x: 0, y: 0, kind: "wall" },
    ];
    expect(keys(maze)).toContain("maze.validate.duplicateSegment");
  });

  it("rejects gate ids that are not exactly 1..gateCount", () => {
    const maze = square();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 2 }];
    maze.keys = [{ gate: 2, x: 1, y: 1 }];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.gateIdsNotContiguous",
    );
  });

  it("rejects one gate id used twice", () => {
    const maze = square();
    maze.segments = [
      { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
      { o: "V", x: 0, y: 1, kind: "gate", gate: 1 },
    ];
    maze.keys = [{ gate: 1, x: 1, y: 1 }];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.gateIdReused",
    );
  });

  it("rejects a gate with no key", () => {
    const maze = square();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.gateWithoutKey",
    );
  });

  it("rejects a key whose cell is not painted", () => {
    const maze = square();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }];
    maze.keys = [{ gate: 1, x: 9, y: 9 }];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.keyOutsideShape",
    );
  });

  it("accepts a one-cell-wide corridor", () => {
    // Spec §3.3: there is deliberately no minimum width.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
      segments: [],
      keys: [],
    };
    expect(validateStructure(maze, { cellCount: 3, gateCount: 0 })).toEqual([]);
  });

  it("every issue it can produce is a message key", () => {
    const maze = square();
    maze.cells[1] = { x: 0, y: 0 };
    maze.start = { x: 9, y: 9 };
    maze.segments = [{ o: "H", x: 0, y: 1, kind: "wall" }];
    for (const issue of validateStructure(maze, { cellCount: 9, gateCount: 3 })) {
      expect(issue.key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/maze/validate.test.ts`

Expected: FAIL — cannot resolve `~/maze/validate`.

- [ ] **Step 3: Write the implementation**

Create `src/maze/validate.ts`:

```ts
import type { TranslatableIssue } from "~/lib/issues";
import { MAX_BOUNDING_BOX, type Maze } from "./format";
import { cellKey, edgeKey, step } from "./geometry";

export type MazeSettings = { cellCount: number; gateCount: number };

/**
 * The eleven structural rules from spec §4.1. Returns every issue it finds
 * rather than the first, because the editor shows them all at once.
 *
 * Solvability is deliberately not here — it is a search, it belongs in
 * `solve.ts`, and a maze can be worth reporting on structurally long before it
 * is solvable.
 */
export function validateStructure(
  maze: Maze,
  settings: MazeSettings,
): TranslatableIssue[] {
  const issues: TranslatableIssue[] = [];
  const add = (key: string, params?: Record<string, string | number>) =>
    issues.push(params ? { key, params } : { key });

  const painted = new Set(maze.cells.map(cellKey));

  if (maze.cells.length !== settings.cellCount) {
    add("maze.validate.wrongCellCount", {
      expected: settings.cellCount,
      actual: maze.cells.length,
    });
  }

  if (painted.size !== maze.cells.length) add("maze.validate.duplicateCell");

  const width = Math.max(...maze.cells.map((c) => c.x)) -
    Math.min(...maze.cells.map((c) => c.x)) + 1;
  const height = Math.max(...maze.cells.map((c) => c.y)) -
    Math.min(...maze.cells.map((c) => c.y)) + 1;
  if (width > MAX_BOUNDING_BOX || height > MAX_BOUNDING_BOX) {
    add("maze.validate.boundingBoxTooLarge", {
      max: MAX_BOUNDING_BOX,
      width,
      height,
    });
  }

  if (!isConnected(maze, painted)) add("maze.validate.disconnectedShape");

  const startIn = painted.has(cellKey(maze.start));
  const treasureIn = painted.has(cellKey(maze.treasure));
  if (!startIn) add("maze.validate.startNotInShape");
  if (!treasureIn) add("maze.validate.treasureNotInShape");
  if (cellKey(maze.start) === cellKey(maze.treasure)) {
    add("maze.validate.startIsTreasure");
  }

  // Occupancy: at most one of { key, treasure } per cell, and nothing on start.
  const occupied = new Map<string, number>();
  occupied.set(cellKey(maze.treasure), 1);
  for (const key of maze.keys) {
    const at = cellKey(key);
    occupied.set(at, (occupied.get(at) ?? 0) + 1);
    if (at === cellKey(maze.start)) add("maze.validate.keyOnStart");
    if (!painted.has(at)) add("maze.validate.keyOutsideShape", { gate: key.gate });
  }
  for (const [, count] of occupied) {
    if (count > 1) {
      add("maze.validate.cellHoldsTwoThings");
      break;
    }
  }

  // Segments: both sides painted, and no edge named twice.
  const seenEdges = new Set<string>();
  for (const segment of maze.segments) {
    const here = { x: segment.x, y: segment.y };
    const other = segment.o === "H" ? step(here, "S") : step(here, "E");
    if (!painted.has(cellKey(here)) || !painted.has(cellKey(other))) {
      add("maze.validate.segmentOutsideShape");
    }
    const id = edgeKey(segment);
    if (seenEdges.has(id)) add("maze.validate.duplicateSegment");
    seenEdges.add(id);
  }

  // Gates: ids exactly 1..gateCount, each on one segment, each with one key.
  const gateIds = maze.segments
    .filter((s) => s.kind === "gate")
    .map((s) => s.gate);
  const gateSet = new Set(gateIds);
  if (gateSet.size !== gateIds.length) add("maze.validate.gateIdReused");

  const expected = Array.from({ length: settings.gateCount }, (_, i) => i + 1);
  const contiguous =
    gateSet.size === settings.gateCount && expected.every((id) => gateSet.has(id));
  if (!contiguous) {
    add("maze.validate.gateIdsNotContiguous", { expected: settings.gateCount });
  }

  for (const id of gateSet) {
    const matching = maze.keys.filter((k) => k.gate === id);
    if (matching.length === 0) add("maze.validate.gateWithoutKey", { gate: id });
    if (matching.length > 1) add("maze.validate.gateWithTwoKeys", { gate: id });
  }
  for (const key of maze.keys) {
    if (!gateSet.has(key.gate)) {
      add("maze.validate.keyWithoutGate", { gate: key.gate });
    }
  }

  return issues;
}

/**
 * Flood fill over painted cells, ignoring walls entirely. This asks whether
 * the shape is one piece, not whether it is traversable — a sealed pocket is
 * legal (spec §4.2), a floating island is not.
 */
function isConnected(maze: Maze, painted: Set<string>): boolean {
  const first = maze.cells[0];
  if (!first) return false;

  const seen = new Set<string>([cellKey(first)]);
  const queue = [first];

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const dir of ["N", "E", "S", "W"] as const) {
      const next = step(current, dir);
      const id = cellKey(next);
      if (painted.has(id) && !seen.has(id)) {
        seen.add(id);
        queue.push(next);
      }
    }
  }

  return seen.size === painted.size;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/unit/maze/validate.test.ts`

Expected: PASS, 19 tests.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
git add -A
git commit -m "$(cat <<'MSG'
feat: add structural maze validation

The eleven rules from spec section 4.1, reported all at once as keyed issues
with params so the editor can show every problem rather than the first. Shape
connectivity is a flood fill that ignores walls: a floating island fails, a
sealed pocket does not.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The key-aware solver

**Files:**
- Create: `src/maze/solve.ts`
- Test: `tests/unit/maze/solve.test.ts`

**Interfaces:**
- Consumes: `Maze`, `Direction`, `DIRECTIONS`, `MAX_GATES` (Task 2); `step`, `cellKey`, `edgeBetween`, `edgeKey` (Task 3).
- Produces: `SolveResult` (`{ solvable: boolean; optimalMoves: number | null }`) and `solve(maze: Maze): SolveResult`, from `~/maze/solve`.

The search is over `(cell, keysHeld)` rather than over cells, which is what
makes it correct in the presence of gates: the same square means something
different depending on which keys you are carrying. Spec §4.2 notes that this
single search subsumes the ordering rule — a key locked behind its own gate
simply never appears in a reachable state.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/maze/solve.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Maze } from "~/maze/format";
import { solve } from "~/maze/solve";

/** A 1xN corridor from (0,0) to (n-1,0). */
function corridor(n: number): Maze {
  return {
    version: 1,
    cells: Array.from({ length: n }, (_, x) => ({ x, y: 0 })),
    start: { x: 0, y: 0 },
    treasure: { x: n - 1, y: 0 },
    segments: [],
    keys: [],
  };
}

describe("solve", () => {
  it("finds the straight-line route through a corridor", () => {
    expect(solve(corridor(5))).toEqual({ solvable: true, optimalMoves: 4 });
  });

  it("reports a treasure walled off from the start as unsolvable", () => {
    const maze = corridor(3);
    maze.segments = [{ o: "V", x: 1, y: 0, kind: "wall" }];
    expect(solve(maze)).toEqual({ solvable: false, optimalMoves: null });
  });

  it("counts the detour to fetch a key", () => {
    // Corridor of 4 with a gate between (2,0) and (3,0). The key lies on the
    // way at (1,0), so the route is three moves east and no detour — the
    // point is that the solver picks the key up in passing rather than
    // treating the gate as impassable.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 3, y: 0 },
      segments: [{ o: "V", x: 2, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 1, y: 0 }],
    };
    expect(solve(maze)).toEqual({ solvable: true, optimalMoves: 3 });
  });

  it("rejects a key locked behind its own gate", () => {
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
      segments: [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 1, y: 0 }],
    };
    expect(solve(maze).solvable).toBe(false);
  });

  it("accepts a decorative gate whose key is unreachable", () => {
    // Spec §4.2: misdirection is legal. The treasure is reachable without
    // ever opening gate 1, so the maze is valid even though gate 1 never can be.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 1, y: 0 },
      segments: [{ o: "H", x: 0, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 0, y: 1 }],
    };
    expect(solve(maze).solvable).toBe(true);
  });

  it("accepts a sealed pocket", () => {
    // (1,1) is walled off on both its open sides. Only the treasure must be
    // reachable, not every cell.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 1, y: 0 },
      segments: [
        { o: "H", x: 1, y: 0, kind: "wall" },
        { o: "V", x: 0, y: 1, kind: "wall" },
      ],
      keys: [],
    };
    expect(solve(maze).solvable).toBe(true);
  });

  it("treats a void square as solid", () => {
    // (1,0) is not painted, so there is no route from (0,0) to (2,0).
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
      segments: [],
      keys: [],
    };
    expect(solve(maze).solvable).toBe(false);
  });

  it("gives the same verdict wherever the maze sits on the canvas", () => {
    const base = corridor(4);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 12 }),
        (dx, dy) => {
          const moved: Maze = {
            ...base,
            cells: base.cells.map((c) => ({ x: c.x + dx, y: c.y + dy })),
            start: { x: base.start.x + dx, y: base.start.y + dy },
            treasure: { x: base.treasure.x + dx, y: base.treasure.y + dy },
          };
          expect(solve(moved)).toEqual(solve(base));
        },
      ),
    );
  });

  it("never reports a route shorter than the straight-line distance", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), (n) => {
        const result = solve(corridor(n));
        expect(result.optimalMoves).toBeGreaterThanOrEqual(n - 1);
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/maze/solve.test.ts`

Expected: FAIL — cannot resolve `~/maze/solve`.

- [ ] **Step 3: Write the implementation**

Create `src/maze/solve.ts`:

```ts
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
      segment.kind === "gate" ? { kind: "gate", gate: segment.gate } : { kind: "wall" },
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

  if (cellKey(maze.start) === treasure) return { solvable: true, optimalMoves: 0 };

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
        if (blocker?.kind === "gate" && !holds(state.keys, blocker.gate)) continue;

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/unit/maze/solve.test.ts`

Expected: PASS, 9 tests.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
git add -A
git commit -m "$(cat <<'MSG'
feat: add the key-aware maze solver

Breadth-first search over (cell, keysHeld) rather than over cells, because the
same square means something different depending on which keys you carry. This
single search subsumes the ordering rule: a key locked behind its own gate
never appears in a reachable state, so the maze simply fails.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The move reducer

**Files:**
- Create: `src/maze/reduce.ts`
- Test: `tests/unit/maze/reduce.test.ts`

**Interfaces:**
- Consumes: `Maze`, `Direction`, `DIRECTIONS`, `Point` (Task 2); `step`, `cellKey`, `edgeBetween`, `edgeKey` (Task 3).
- Produces, from `~/maze/reduce`:
  - `ServerOutcome` — the seven values from spec §7
  - `RunnerOutcome` — `Exclude<ServerOutcome, "blocked_boundary">`
  - `RunState` (`{ at: Point; keys: number; openedGates: number; penalties: number; moves: number; finished: boolean }`)
  - `RunnerDelta`
  - `initialRunState(maze: Maze): RunState`
  - `applyMove(maze: Maze, state: RunState, dir: Direction): { state: RunState; delta: RunnerDelta; outcome: ServerOutcome }`

This is the heart of the game, and it is the one module where a leak is not a
bug but a loss: anything the delta contains, the runner knows.

A note on cost, so it is a decision rather than an oversight: `applyMove`
rebuilds its painted-cell set and scans `segments` on every call, so a move is
O(cells + segments). At 144 cells and a few hundred moves per run that is
nothing, and the simplicity is worth more than the cycles while the rules are
still settling. Phase 4 serves this from a request handler and can precompute
an index then, if profiling ever says so.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/maze/reduce.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DIRECTIONS, type Maze } from "~/maze/format";
import { applyMove, initialRunState } from "~/maze/reduce";

/** Two cells side by side, treasure on the right. */
function pair(): Maze {
  return {
    version: 1,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    start: { x: 0, y: 0 },
    treasure: { x: 1, y: 0 },
    segments: [],
    keys: [],
  };
}

describe("applyMove", () => {
  it("moves into an open cell without penalty", () => {
    const maze = pair();
    const { state, delta, outcome } = applyMove(maze, initialRunState(maze), "E");
    expect(outcome).toBe("moved_found_treasure");
    expect(state.at).toEqual({ x: 1, y: 0 });
    expect(state.penalties).toBe(0);
    expect(state.moves).toBe(1);
    expect(delta.finished).toBe(true);
  });

  it("charges a penalty for walking into a wall and does not move", () => {
    const maze = pair();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "wall" }];
    const { state, delta, outcome } = applyMove(maze, initialRunState(maze), "E");
    expect(outcome).toBe("blocked_wall");
    expect(state.at).toEqual({ x: 0, y: 0 });
    expect(state.penalties).toBe(1);
    expect(delta.revealedSegment).toEqual({ o: "V", x: 0, y: 0, kind: "wall" });
  });

  it("charges a penalty for walking off the shape", () => {
    const maze = pair();
    const { state, outcome } = applyMove(maze, initialRunState(maze), "W");
    expect(outcome).toBe("blocked_boundary");
    expect(state.penalties).toBe(1);
    expect(state.at).toEqual({ x: 0, y: 0 });
  });

  it("picks up a key and reveals it", () => {
    const withKey: Maze = {
      ...pair(),
      segments: [{ o: "H", x: 0, y: 0, kind: "gate", gate: 2 }],
      keys: [{ gate: 2, x: 1, y: 0 }],
    };
    const { state, delta, outcome } = applyMove(
      withKey,
      initialRunState(withKey),
      "E",
    );
    expect(outcome).toBe("moved_found_key");
    expect(delta.revealedCell).toEqual({ x: 1, y: 0, key: 2 });
    expect(state.keys).toBe(1 << 1);
  });

  it("blocks a gate without its key, revealing which gate it is", () => {
    const maze = pair();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 3 }];
    maze.keys = [{ gate: 3, x: 1, y: 0 }];
    const { state, delta, outcome } = applyMove(maze, initialRunState(maze), "E");
    expect(outcome).toBe("blocked_gate");
    expect(state.penalties).toBe(1);
    expect(delta.revealedSegment).toEqual({
      o: "V",
      x: 0,
      y: 0,
      kind: "gate",
      gate: 3,
    });
  });

  it("passes a gate once its key is held, and the gate stays open", () => {
    // The treasure deliberately sits one cell PAST the gate: if it sat
    // immediately behind it, the outcome would be moved_found_treasure and
    // this test would prove nothing about gates.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 1 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
      segments: [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }],
      keys: [{ gate: 1, x: 0, y: 1 }],
    };

    let state = initialRunState(maze);
    state = applyMove(maze, state, "S").state; // collect key 1
    const crossed = applyMove(maze, { ...state, at: { x: 0, y: 0 } }, "E");

    expect(crossed.outcome).toBe("moved_through_gate");
    expect(crossed.state.penalties).toBe(0);
    expect(crossed.state.openedGates).toBe(1 << 0);
  });

  it("refuses to move once the run has finished", () => {
    const maze = pair();
    const finished = { ...initialRunState(maze), finished: true };
    const { state, outcome } = applyMove(maze, finished, "E");
    expect(outcome).toBe("blocked_wall");
    expect(state).toEqual(finished);
  });
});

describe("the runner cannot tell a void square from a wall", () => {
  it("produces byte-identical deltas for both", () => {
    // Spec §2.2 and invariant 6: this is the difference between a hidden maze
    // and a guessable one. Walking west off the shape and walking east into a
    // wall must look exactly the same to the runner.
    const walled = pair();
    walled.segments = [{ o: "V", x: 0, y: 0, kind: "wall" }];
    const intoWall = applyMove(walled, initialRunState(walled), "E");

    const open = pair();
    const offShape = applyMove(open, initialRunState(open), "W");

    // Normalise the two edges they bumped, since those legitimately differ.
    const strip = (d: typeof intoWall.delta) => ({
      ...d,
      revealedSegment: d.revealedSegment
        ? { kind: d.revealedSegment.kind }
        : undefined,
    });

    expect(JSON.stringify(strip(offShape.delta))).toBe(
      JSON.stringify(strip(intoWall.delta)),
    );
    expect(offShape.delta.outcome).toBe(intoWall.delta.outcome);
  });
});

describe("invariants", () => {
  const maze = pair();

  it("never decreases penalties or moves", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...DIRECTIONS), { maxLength: 40 }),
        (dirs) => {
          let state = initialRunState(maze);
          for (const dir of dirs) {
            const next = applyMove(maze, state, dir).state;
            expect(next.penalties).toBeGreaterThanOrEqual(state.penalties);
            expect(next.moves).toBeGreaterThanOrEqual(state.moves);
            state = next;
          }
        },
      ),
    );
  });

  it("never reveals a cell the runner did not enter", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...DIRECTIONS), { maxLength: 40 }),
        (dirs) => {
          let state = initialRunState(maze);
          for (const dir of dirs) {
            const { state: next, delta } = applyMove(maze, state, dir);
            if (delta.revealedCell) {
              expect(delta.revealedCell).toMatchObject({
                x: next.at.x,
                y: next.at.y,
              });
            }
            state = next;
          }
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/maze/reduce.test.ts`

Expected: FAIL — cannot resolve `~/maze/reduce`.

- [ ] **Step 3: Write the implementation**

Create `src/maze/reduce.ts`:

```ts
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
    return { state, delta: blockDelta(state, "blocked_wall"), outcome: "blocked_wall" };
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
    return blocked(state, "blocked_gate", { ...edge, kind: "gate", gate: segment.gate });
  }

  const throughGate = segment?.kind === "gate";
  const keyHere = maze.keys.find((k) => cellKey(k) === cellKey(destination));
  const isTreasure = cellKey(destination) === cellKey(maze.treasure);

  const next: RunState = {
    at: destination,
    keys: keyHere ? state.keys | bit(keyHere.gate) : state.keys,
    openedGates: throughGate ? state.openedGates | bit(segment.gate) : state.openedGates,
    penalties: state.penalties,
    moves: state.moves + 1,
    finished: isTreasure,
  };

  const outcome: ServerOutcome = isTreasure
    ? "moved_found_treasure"
    : keyHere
      ? "moved_found_key"
      : throughGate
        ? "moved_through_gate"
        : "moved";

  const revealedCell: RevealedCell = { x: destination.x, y: destination.y };
  if (keyHere) revealedCell.key = keyHere.gate;
  if (isTreasure) revealedCell.treasure = true;

  return {
    state: next,
    delta: {
      outcome,
      at: next.at,
      penalties: next.penalties,
      moves: next.moves,
      finished: next.finished,
      revealedCell,
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
    outcome === "blocked_boundary" ? "blocked_wall" : (outcome as RunnerOutcome);

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/unit/maze/reduce.test.ts`

Expected: PASS, 11 tests.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
git add -A
git commit -m "$(cat <<'MSG'
feat: add the maze move reducer

Seven server-side outcomes, collapsed to six on the way to the runner: walking
off the painted shape is reported exactly as walking into a wall, because a
runner who could tell them apart could map the maze by bumping. Property tests
assert the two deltas are byte-identical, that penalties never decrease, and
that no cell is revealed that the runner did not enter.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The public entry point

**Files:**
- Create: `src/maze/index.ts`
- Create: `tests/unit/maze/validate-maze.test.ts`
- Modify: `src/maze/validate.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: `validateMaze(input: unknown, settings: MazeSettings): MazeValidation` from `~/maze`, where `MazeValidation` is `{ ok: true; maze: Maze; contentHash: string; optimalMoves: number }` or `{ ok: false; issues: TranslatableIssue[] }`. Phase 2's editor and Phase 3's submit procedure both call exactly this.

One call that takes untrusted input and returns either a storable maze with its
derived metrics, or every reason it was rejected. Three passes in order — shape,
structure, solvability — because a solvability search over a structurally
broken maze is meaningless.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/maze/validate-maze.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { validateMaze } from "~/maze";

const corridor = {
  version: 1,
  cells: [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 7, y: 5 },
  ],
  start: { x: 5, y: 5 },
  treasure: { x: 7, y: 5 },
  segments: [],
  keys: [],
};

const settings = { cellCount: 3, gateCount: 0 };

describe("validateMaze", () => {
  it("accepts a valid maze and returns its derived metrics", () => {
    const result = validateMaze(corridor, settings);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.optimalMoves).toBe(2);
      expect(result.contentHash).toMatch(/^[0-9a-f]{16}$/);
      // The stored maze is normalized, so its origin is (0,0).
      expect(result.maze.start).toEqual({ x: 0, y: 0 });
    }
  });

  it("stops at the shape pass when the input is not a maze", () => {
    const result = validateMaze({ nope: true }, settings);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it("reports structural problems without attempting a search", () => {
    const result = validateMaze(corridor, { cellCount: 36, gateCount: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toEqual([
        "maze.validate.wrongCellCount",
      ]);
    }
  });

  it("reports an unreachable treasure", () => {
    const walled = {
      ...corridor,
      segments: [{ o: "V", x: 5, y: 5, kind: "wall" }],
    };
    const result = validateMaze(walled, settings);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toContain(
        "maze.validate.treasureUnreachable",
      );
    }
  });

  it("gives an identical hash for the same maze drawn elsewhere", () => {
    const moved = {
      ...corridor,
      cells: corridor.cells.map((c) => ({ x: c.x - 5, y: c.y - 5 })),
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
    };
    const a = validateMaze(corridor, settings);
    const b = validateMaze(moved, settings);
    expect(a.ok && b.ok && a.contentHash === b.contentHash).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/maze/validate-maze.test.ts`

Expected: FAIL — cannot resolve `~/maze`.

- [ ] **Step 3: Write the barrel and the entry point**

Create `src/maze/index.ts`:

```ts
import type { TranslatableIssue } from "~/lib/issues";
import { parseMaze, type Maze } from "./format";
import { contentHash, normalize } from "./normalize";
import { solve } from "./solve";
import { validateStructure, type MazeSettings } from "./validate";

export * from "./format";
export * from "./geometry";
export * from "./normalize";
export * from "./reduce";
export * from "./solve";
export * from "./validate";

export type MazeValidation =
  | { ok: true; maze: Maze; contentHash: string; optimalMoves: number }
  | { ok: false; issues: TranslatableIssue[] };

/**
 * The single call that turns untrusted input into either a storable maze with
 * its derived metrics, or every reason it was rejected.
 *
 * Three passes, and the order matters: a solvability search over a
 * structurally broken maze would be meaningless, and a structural check over
 * something that is not even shaped like a maze would be noise.
 */
export function validateMaze(
  input: unknown,
  settings: MazeSettings,
): MazeValidation {
  const parsed = parseMaze(input);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };

  const structural = validateStructure(parsed.maze, settings);
  if (structural.length > 0) return { ok: false, issues: structural };

  const solution = solve(parsed.maze);
  if (!solution.solvable || solution.optimalMoves === null) {
    return { ok: false, issues: [{ key: "maze.validate.treasureUnreachable" }] };
  }

  return {
    ok: true,
    maze: normalize(parsed.maze),
    contentHash: contentHash(parsed.maze),
    optimalMoves: solution.optimalMoves,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/unit/maze/validate-maze.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the whole suite and confirm the boundary still holds**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

Then prove the purity rule covers the finished module, not just an empty
directory:

```bash
cat > src/maze/boundary-probe.ts <<'PROBE'
import { readFileSync } from "node:fs";
export const probe = readFileSync;
PROBE
pnpm lint 2>&1 | grep -q "src/maze must stay pure" && echo "RULE FIRES" || echo "RULE DID NOT FIRE"
rm src/maze/boundary-probe.ts
```

Expected: `RULE FIRES`, and `git status` clean of the probe afterwards.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
feat: add the maze domain's public entry point

One call from untrusted input to either a storable, normalized maze with its
content hash and optimal route, or every reason it was rejected. Shape,
structure, then solvability — in that order, because each pass is meaningless
over input the previous one rejected.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Phase 1 exit criteria

- [ ] `src/maze/` exports `validateMaze`, `solve`, `applyMove`, `normalize` and
      `contentHash`, and imports nothing from Next, React, tRPC, Drizzle or Node.
- [ ] The ESLint purity rule has been watched to fire against the finished
      module, with a real framework import and a real Node builtin.
- [ ] Every validation failure is a message key; a test asserts no English prose
      can escape either the parser or the structural validator.
- [ ] Property tests cover: hash stability under translation and reordering,
      solver verdict stability under translation, penalty monotonicity, and the
      wall/void indistinguishability that invariant 6 depends on.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and
      `pnpm build` all pass.

## Deliberately not in this phase

- **No UI.** The editor is Phase 2; this phase ships no component.
- **No persistence.** The `maze` table exists from Phase 0 but nothing writes to
  it until Phase 3.
- **No Slovak catalogue entries for the new keys.** The keys are defined here and
  consumed by Phase 2's editor panel, which is where they first become visible
  copy and where both catalogues gain them together.
- **`create-branch-action` is on v6.4.0 upstream**; we pin v5.2.0. Carried from
  Phase 0 as a known upgrade, not urgent.
