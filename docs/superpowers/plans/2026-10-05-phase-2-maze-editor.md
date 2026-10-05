# Labyrinth Phase 2 — Maze Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in person draw a labyrinth — paint its shape, place walls,
gates, keys, a start and a treasure — see continuously whether it is valid, and
have the work survive a page refresh.

**Architecture:** The editor's logic lives in a **pure reducer** in
`src/maze/`-adjacent code, not in a component: every edit is an action, undo and
redo are stacks of states, and the budget counter and validity are derived. That
keeps the hard part testable in Vitest with no browser, and leaves Playwright to
prove the wiring. The board is SVG with addressable nodes — `data-cell="3,4"`,
`data-edge="H:3,4"` — so tests click semantic targets rather than pixel offsets.

**Tech Stack:** Next.js App Router, React 19, tRPC, Drizzle, Tailwind v4,
next-intl, Vitest, Playwright. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-22-labyrinth-design.md` — §3 (format),
§4 (validation), §6 (the `maze` row), §10.1 (rendering), §10.2 (the editor) and
§12 (testing) are what this phase implements.

## Global Constraints

- **`src/maze/` imports nothing** from Next, React, tRPC, Drizzle, Better Auth,
  next-intl or Node builtins. ESLint enforces it for `src/maze/**` and
  `src/lib/issues.ts`. Editor *components* live in `src/components/`; editor
  *logic* that is pure belongs in `src/maze/`.
- **Validation failures travel as i18n message keys with parameters, never as
  English strings.** `MAZE_ISSUE_KEYS` and `MAZE_FORMAT_ISSUE_KEYS` are the
  complete inventory. This phase is the first to render them.
- **Locales are `en` and `sk`**, `en` the fallback. A unit test fails the build
  if the catalogues drift apart.
- **Colours come from the tokens** in `src/styles/globals.css`: `bg`, `fg`,
  `muted`, `border`, `border-strong`, `accent`, `on-accent`, `danger`. No raw
  hex. Interactive controls use `border-strong` (3:1), not `border` (1.31:1).
- **The board is a fixed 16 × 16 frame.** Coordinates are absolute, 0–15. Not a
  pannable canvas — this was ruled in Phase 1 and written into spec §3.3.
- **`~/server/db` may not be imported** from `src/app/**` or `src/components/**`
  except layouts and `src/app/api/**`. Go through a tRPC procedure.
- **Every user-visible string lives in a message catalogue.**
- Node 24, pnpm 11. TypeScript strict plus `noUncheckedIndexedAccess`. No `any`.
- **Any task touching `src/server/**` runs `pnpm test:integration`.**
- Every task ends with a commit in Conventional Commits format ending with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Carried in from Phase 1

Three things were deferred to this phase and are tasks here, not afterthoughts:

1. **There is no format for a half-drawn maze.** `mazeSchema` requires `start`
   and `treasure`; an author who has painted ten cells has neither. Task 1.
2. **No catalogue contains a single `maze.*` key.** Twenty-four keys are emitted
   by shipped code and none resolves. Task 1.
3. **`AGENTS.md` invariant 2 names only `src/maze/`** while the ESLint message
   now also names `src/lib/issues.ts`. One sentence. Task 1.

## File Structure

```
src/maze/draft.ts              DraftMaze schema, emptyDraft, draftToMaze
src/maze/editor-state.ts       the pure editor reducer, undo/redo, derived facts
src/server/db/schema/maze.ts   the maze table
src/server/api/routers/maze.ts list / get / createDraft / saveDraft / delete
src/components/editor/board.tsx          SVG board, addressable nodes, no state
src/components/editor/shape-tools.tsx    shape-mode controls
src/components/editor/detail-tools.tsx   the palette
src/components/editor/validation-panel.tsx  facts, never judgement
src/components/editor/maze-editor.tsx    wires reducer + board + panels + autosave
src/app/[locale]/(app)/labyrinths/page.tsx       the list
src/app/[locale]/(app)/labyrinths/[id]/page.tsx  the editor
```

Tests mirror those paths under `tests/unit/maze/`, `tests/integration/` and `e2e/`.

---

### Task 1: The draft format, the message keys, and the invariant

**Files:**
- Create: `src/maze/draft.ts`
- Modify: `src/maze/format.ts`, `src/maze/index.ts`, `messages/en.json`, `messages/sk.json`, `AGENTS.md`
- Test: `tests/unit/maze/draft.test.ts`, `tests/unit/maze/issue-keys-resolve.test.ts`

**Interfaces:**
- Consumes: `mazeSchema`, `Maze`, `MAZE_ISSUE_KEYS`, `MAZE_FORMAT_ISSUE_KEYS` from `~/maze`.
- Produces: `draftMazeSchema`, `DraftMaze`, `emptyDraft(): DraftMaze`, `draftToMaze(draft: DraftMaze): Maze | null`, and the exported piece schemas `pointSchema`, `segmentSchema`, `mazeKeySchema` from `~/maze/format`.

- [ ] **Step 1: Write the failing test for the draft format**

Create `tests/unit/maze/draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { draftMazeSchema, draftToMaze, emptyDraft } from "~/maze/draft";

describe("emptyDraft", () => {
  it("is a valid draft with nothing placed", () => {
    const draft = emptyDraft();
    expect(draftMazeSchema.safeParse(draft).success).toBe(true);
    expect(draft.cells).toEqual([]);
    expect(draft.start).toBeNull();
    expect(draft.treasure).toBeNull();
  });
});

describe("draftMazeSchema", () => {
  it("accepts a half-drawn maze with no start or treasure", () => {
    const result = draftMazeSchema.safeParse({
      version: 1,
      cells: [{ x: 0, y: 0 }],
      start: null,
      treasure: null,
      segments: [],
      keys: [],
    });
    expect(result.success).toBe(true);
  });

  it("still rejects an out-of-frame coordinate", () => {
    // A draft is permissive about completeness, never about the frame.
    const result = draftMazeSchema.safeParse({
      ...emptyDraft(),
      cells: [{ x: 16, y: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("draftToMaze", () => {
  it("returns null while the start is missing", () => {
    expect(
      draftToMaze({ ...emptyDraft(), cells: [{ x: 0, y: 0 }], treasure: { x: 0, y: 0 } }),
    ).toBeNull();
  });

  it("returns null while the treasure is missing", () => {
    expect(
      draftToMaze({ ...emptyDraft(), cells: [{ x: 0, y: 0 }], start: { x: 0, y: 0 } }),
    ).toBeNull();
  });

  it("upgrades a complete draft to a Maze", () => {
    const maze = draftToMaze({
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 1, y: 0 },
      segments: [{ o: "V", x: 0, y: 0, kind: "wall" }],
      keys: [],
    });

    expect(maze).not.toBeNull();
    expect(maze?.start).toEqual({ x: 0, y: 0 });
    expect(maze?.segments).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/maze/draft.test.ts`

Expected: FAIL — cannot resolve `~/maze/draft`.

- [ ] **Step 3: Export the piece schemas from `format.ts`**

`src/maze/format.ts` currently keeps `pointSchema`, the segment union and the key
schema as module-local consts. Export them so the draft schema can reuse exactly
the same shapes rather than restating them — a second definition would drift.

Rename and export:

```ts
export const pointSchema = z.object({ x: coordinate, y: coordinate });
export const segmentSchema = z.discriminatedUnion("kind", [ /* unchanged */ ]);
export const mazeKeySchema = z.object({ gate: gateId, x: coordinate, y: coordinate });
```

Update `mazeSchema` and the inferred types to use the exported names. Nothing
else changes; `pnpm test` must stay green.

- [ ] **Step 4: Write the draft module**

Create `src/maze/draft.ts`:

```ts
import { z } from "zod";

import {
  mazeKeySchema,
  pointSchema,
  segmentSchema,
  type Maze,
} from "./format";

/**
 * A maze in progress. The only difference from `Maze` is that `start` and
 * `treasure` may be absent — an author who has painted ten cells has placed
 * neither, and that state must survive a page refresh (spec §10.2).
 *
 * A draft is permissive about completeness and never about the frame: the same
 * coordinate bounds apply, so a draft can never hold a cell the finished maze
 * could not.
 */
export const draftMazeSchema = z.object({
  version: z.literal(1),
  cells: z.array(pointSchema),
  start: pointSchema.nullable(),
  treasure: pointSchema.nullable(),
  segments: z.array(segmentSchema),
  keys: z.array(mazeKeySchema),
});

export type DraftMaze = z.infer<typeof draftMazeSchema>;

export function emptyDraft(): DraftMaze {
  return {
    version: 1,
    cells: [],
    start: null,
    treasure: null,
    segments: [],
    keys: [],
  };
}

/**
 * Upgrades a draft to a `Maze`, or returns null when it is not yet complete.
 * This is a shape conversion only — it says nothing about whether the maze is
 * legal or solvable. `validateMaze` answers that.
 */
export function draftToMaze(draft: DraftMaze): Maze | null {
  if (draft.start === null || draft.treasure === null) return null;

  return {
    version: draft.version,
    cells: draft.cells,
    start: draft.start,
    treasure: draft.treasure,
    segments: draft.segments,
    keys: draft.keys,
  };
}
```

Re-export it from the barrel: add `export * from "./draft";` to `src/maze/index.ts`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tests/unit/maze/draft.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 6: Write the failing test for key resolution**

This is the test Phase 1 could not write, because no key resolved. Create
`tests/unit/maze/issue-keys-resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import sk from "../../../messages/sk.json";
import { MAZE_FORMAT_ISSUE_KEYS, MAZE_ISSUE_KEYS } from "~/maze";

type Catalogue = Record<string, unknown>;

/** Resolves "a.b.c" against a nested catalogue, or undefined. */
function lookup(catalogue: Catalogue, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Catalogue)[part]
          : undefined,
      catalogue,
    );
}

const allKeys = [...MAZE_ISSUE_KEYS, ...MAZE_FORMAT_ISSUE_KEYS];

describe("every maze issue key resolves", () => {
  it("has at least one key to check", () => {
    // Guards against the whole suite passing vacuously if the unions empty out.
    expect(allKeys.length).toBeGreaterThan(20);
  });

  it.each(allKeys)("en: %s", (key) => {
    expect(typeof lookup(en as Catalogue, key)).toBe("string");
  });

  it.each(allKeys)("sk: %s", (key) => {
    expect(typeof lookup(sk as Catalogue, key)).toBe("string");
  });

  it("resolves the generic fallback that src/lib/issues.ts hardcodes", () => {
    expect(typeof lookup(en as Catalogue, "errors.validation.invalid")).toBe("string");
    expect(typeof lookup(sk as Catalogue, "errors.validation.invalid")).toBe("string");
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm test tests/unit/maze/issue-keys-resolve.test.ts`

Expected: FAIL — every `maze.*` assertion fails, because no catalogue contains
any of them. That is the gap this step exists to close.

- [ ] **Step 8: Add the copy to both catalogues**

Add to `messages/en.json`:

```json
{
  "maze": {
    "format": {
      "coordinateNotAnInteger": "A coordinate must be a whole number.",
      "coordinateOutOfRange": "That square is outside the board.",
      "gateIdNotAnInteger": "A gate number must be a whole number.",
      "gateIdOutOfRange": "Gate numbers run from 1 to 8.",
      "unknownVersion": "This labyrinth was saved in a format we no longer read.",
      "noCells": "Paint at least one square."
    },
    "validate": {
      "wrongCellCount": "You have used {actual} of {expected} squares.",
      "duplicateCell": "A square has been painted twice.",
      "boundingBoxTooLarge": "The labyrinth must fit in {max} by {max} squares.",
      "disconnectedShape": "Every square must join the others — no floating islands.",
      "startNotInShape": "The start must sit on a painted square.",
      "treasureNotInShape": "The treasure must sit on a painted square.",
      "startIsTreasure": "The start and the treasure cannot share a square.",
      "keyOnStart": "A key cannot sit on the start square.",
      "keyOutsideShape": "The key for gate {gate} is not on a painted square.",
      "cellHoldsTwoThings": "The square at {x}, {y} holds two things.",
      "segmentOutsideShape": "A wall or gate at {o} {x}, {y} has nothing on one side.",
      "duplicateSegment": "Two things sit on the same edge at {o} {x}, {y}.",
      "gateIdsNotContiguous": "Use gates 1 to {expected}, each exactly once.",
      "gateIdReused": "A gate number has been used twice.",
      "gateWithoutKey": "Gate {gate} has no key.",
      "gateWithTwoKeys": "Gate {gate} has more than one key.",
      "keyWithoutGate": "There is a key for gate {gate}, but no such gate.",
      "treasureUnreachable": "There is no route from the start to the treasure."
    }
  }
}
```

Add to `messages/sk.json`:

```json
{
  "maze": {
    "format": {
      "coordinateNotAnInteger": "Súradnica musí byť celé číslo.",
      "coordinateOutOfRange": "Toto políčko je mimo hracej plochy.",
      "gateIdNotAnInteger": "Číslo brány musí byť celé číslo.",
      "gateIdOutOfRange": "Brány sú číslované od 1 do 8.",
      "unknownVersion": "Toto bludisko bolo uložené vo formáte, ktorý už nečítame.",
      "noCells": "Nakreslite aspoň jedno políčko."
    },
    "validate": {
      "wrongCellCount": "Použili ste {actual} z {expected} políčok.",
      "duplicateCell": "Jedno políčko je nakreslené dvakrát.",
      "boundingBoxTooLarge": "Bludisko sa musí zmestiť do {max} krát {max} políčok.",
      "disconnectedShape": "Každé políčko musí susediť s ostatnými — žiadne ostrovy.",
      "startNotInShape": "Štart musí byť na nakreslenom políčku.",
      "treasureNotInShape": "Poklad musí byť na nakreslenom políčku.",
      "startIsTreasure": "Štart a poklad nemôžu byť na tom istom políčku.",
      "keyOnStart": "Kľúč nemôže ležať na štartovom políčku.",
      "keyOutsideShape": "Kľúč od brány {gate} nie je na nakreslenom políčku.",
      "cellHoldsTwoThings": "Na políčku {x}, {y} sú dve veci.",
      "segmentOutsideShape": "Stena alebo brána na {o} {x}, {y} nemá na jednej strane nič.",
      "duplicateSegment": "Na hrane {o} {x}, {y} sú dve veci naraz.",
      "gateIdsNotContiguous": "Použite brány 1 až {expected}, každú práve raz.",
      "gateIdReused": "Číslo brány je použité dvakrát.",
      "gateWithoutKey": "Brána {gate} nemá kľúč.",
      "gateWithTwoKeys": "Brána {gate} má viac než jeden kľúč.",
      "keyWithoutGate": "Existuje kľúč od brány {gate}, ale taká brána neexistuje.",
      "treasureUnreachable": "Zo štartu sa k pokladu nedá dostať."
    }
  }
}
```

The catalogue-parity test from Phase 0 will fail if the two drift. That is the
test working.

- [ ] **Step 9: Run both tests**

Run: `pnpm test tests/unit/maze/issue-keys-resolve.test.ts tests/unit/i18n-catalogues.test.ts`

Expected: PASS. If a key fails to resolve, the union and the catalogue disagree —
fix the catalogue, not the union, since the union is generated from what the code
actually emits.

- [ ] **Step 10: Close the invariant-2 wording gap**

`eslint.config.js`'s purity message says "src/maze and src/lib/issues.ts must stay
pure — … See AGENTS.md invariant 2", but `AGENTS.md` invariant 2 names only
`src/maze/`. Add `src/lib/issues.ts` to it, with the reason: `src/maze/` imports
it, so a framework import there would break maze purity with the lint rule
pointing at an invariant that does not mention the file.

- [ ] **Step 11: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
git add -A
git commit -m "$(cat <<'MSG'
feat: add the draft maze format and the maze message catalogue

A half-drawn maze has no start and no treasure, so it cannot be a Maze — and
without a representation for it, autosave has nothing to store. Adds the draft
schema, and the English and Slovak copy for all 24 issue keys, which shipped
code has been emitting into catalogues that contained none of them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The maze table and its router

**Files:**
- Create: `src/server/db/schema/maze.ts`, `src/server/api/routers/maze.ts`
- Modify: `src/server/db/schema/index.ts`, `src/server/api/root.ts`
- Test: `tests/integration/maze-router.test.ts`

**Interfaces:**
- Consumes: `protectedProcedure` from `~/server/api/trpc`; `draftMazeSchema`, `DraftMaze`, `emptyDraft`, `draftToMaze`, `validateMaze`, `CELL_COUNT_PRESETS`, `MAX_GATES` from `~/maze`.
- Produces: the `maze` table, and `mazeRouter` with `list`, `get`, `createDraft`, `saveDraft` and `remove`. Signatures appear in step 5.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/maze-router.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { emptyDraft } from "~/maze";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { maze } from "~/server/db/schema";

async function signedIn() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

const settings = { name: "First", cellCount: 36 as const, gateCount: 2 };

describe("maze.createDraft", () => {
  it("creates an empty draft owned by the caller", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);

    const created = await caller.maze.createDraft(settings);

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row?.authorId).toBe(ctx.session!.user.id);
    expect(row?.status).toBe("draft");
    expect(row?.contentHash).toBeNull();
    expect(row?.data).toEqual(emptyDraft());
  });

  it("rejects a cell count that is not a preset", async () => {
    const caller = createCaller(await signedIn());
    await expect(
      caller.maze.createDraft({ ...settings, cellCount: 37 as unknown as 36 }),
    ).rejects.toThrow();
  });

  it("rejects an anonymous caller with a message key", async () => {
    const caller = createCaller(await createTRPCContext({ headers: new Headers() }));
    await expect(caller.maze.createDraft(settings)).rejects.toThrow(
      "errors.notSignedIn",
    );
  });
});

describe("maze.saveDraft", () => {
  it("stores the draft and leaves derived columns null while invalid", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);

    const result = await caller.maze.saveDraft({
      id: created.id,
      data: { ...emptyDraft(), cells: [{ x: 0, y: 0 }] },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row?.contentHash).toBeNull();
    expect(row?.optimalMoves).toBeNull();
  });

  it("refuses to touch a maze belonging to someone else", async () => {
    const owner = createCaller(await signedIn());
    const created = await owner.maze.createDraft(settings);

    const stranger = createCaller(await signedIn());
    await expect(
      stranger.maze.saveDraft({ id: created.id, data: emptyDraft() }),
    ).rejects.toThrow("errors.notYourMaze");
  });
});

describe("maze.list", () => {
  it("returns only the caller's mazes, newest first", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    const first = await caller.maze.createDraft({ ...settings, name: "One" });
    const second = await caller.maze.createDraft({ ...settings, name: "Two" });

    const stranger = createCaller(await signedIn());
    await stranger.maze.createDraft({ ...settings, name: "Theirs" });

    const mine = await caller.maze.list();
    expect(mine.map((m) => m.id)).toEqual([second.id, first.id]);
    expect(mine.every((m) => m.name !== "Theirs")).toBe(true);
  });

  it("does not return the maze data — the list only needs summaries", async () => {
    const caller = createCaller(await signedIn());
    await caller.maze.createDraft(settings);
    const [summary] = await caller.maze.list();
    expect(summary).toBeDefined();
    expect(summary).not.toHaveProperty("data");
  });
});

describe("maze.get", () => {
  it("returns the caller's own maze", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);
    const fetched = await caller.maze.get({ id: created.id });
    expect(fetched.id).toBe(created.id);
    expect(fetched.data).toEqual(emptyDraft());
  });

  it("refuses someone else's maze", async () => {
    const owner = createCaller(await signedIn());
    const created = await owner.maze.createDraft(settings);
    const stranger = createCaller(await signedIn());
    await expect(stranger.maze.get({ id: created.id })).rejects.toThrow(
      "errors.notYourMaze",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:integration tests/integration/maze-router.test.ts`

Expected: FAIL — `maze` is not exported from the schema and `caller.maze` does
not exist.

- [ ] **Step 3: Add the table**

Create `src/server/db/schema/maze.ts`:

```ts
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Spec §6. `data` holds a DraftMaze while `status` is "draft" and a Maze once
 * submitted — the same column, because a draft becomes the maze rather than
 * being copied into one.
 *
 * `contentHash` and `optimalMoves` are null until the maze validates: they are
 * derived by the solver and a half-drawn maze has neither.
 */
export const maze = pgTable(
  "maze",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cellCount: integer("cell_count").notNull(),
    gateCount: integer("gate_count").notNull(),
    data: jsonb("data").notNull(),
    contentHash: text("content_hash"),
    optimalMoves: integer("optimal_moves"),
    status: text("status", { enum: ["draft", "submitted"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("maze_author_updated_idx").on(table.authorId, table.updatedAt)],
);
```

Re-export from `src/server/db/schema/index.ts`:

```ts
export * from "./auth";
export * from "./maze";
```

- [ ] **Step 4: Generate and apply the migration**

```bash
pnpm db:generate
pnpm db:migrate
```

Read the generated SQL before applying. It must be one `CREATE TABLE` plus the
index and the foreign key — nothing dropped, nothing altered.

- [ ] **Step 5: Write the router**

Create `src/server/api/routers/maze.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  CELL_COUNT_PRESETS,
  MAX_GATES,
  draftMazeSchema,
  draftToMaze,
  emptyDraft,
  validateMaze,
} from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { maze } from "~/server/db/schema";

const settingsInput = z.object({
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
});

/**
 * Narrows a possibly-missing row, throwing a keyed error. Each procedure runs
 * its own query filtered by author, so "not found" and "not yours" are the
 * same answer — which is also the right answer to give, since distinguishing
 * them would confirm that someone else's maze exists.
 */
function assertOwned<T>(row: T | undefined): T {
  if (!row) {
    throw new TRPCError({ code: "FORBIDDEN", message: "errors.notYourMaze" });
  }
  return row;
}

/** The ownership filter every read and write shares. */
function ownedBy(id: string, userId: string) {
  return and(eq(maze.id, id), eq(maze.authorId, userId));
}

export const mazeRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) =>
    ctx.db
      .select({
        id: maze.id,
        name: maze.name,
        cellCount: maze.cellCount,
        gateCount: maze.gateCount,
        status: maze.status,
        updatedAt: maze.updatedAt,
      })
      .from(maze)
      .where(eq(maze.authorId, ctx.session.user.id))
      .orderBy(desc(maze.updatedAt)),
  ),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [found] = await ctx.db
        .select()
        .from(maze)
        .where(ownedBy(input.id, ctx.session.user.id));
      const row = assertOwned(found);
      return { ...row, data: draftMazeSchema.parse(row.data) };
    }),

  createDraft: protectedProcedure
    .input(settingsInput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(maze)
        .values({
          authorId: ctx.session.user.id,
          name: input.name,
          cellCount: input.cellCount,
          gateCount: input.gateCount,
          data: emptyDraft(),
        })
        .returning({ id: maze.id });

      if (!row) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "errors.unknown" });
      }
      return row;
    }),

  saveDraft: protectedProcedure
    .input(z.object({ id: z.string(), data: draftMazeSchema }))
    .mutation(async ({ ctx, input }) => {
      const [found] = await ctx.db
        .select()
        .from(maze)
        .where(ownedBy(input.id, ctx.session.user.id));
      const row = assertOwned(found);

      if (row.status === "submitted") {
        throw new TRPCError({ code: "FORBIDDEN", message: "errors.mazeIsSubmitted" });
      }

      const complete = draftToMaze(input.data);
      const validation = complete
        ? validateMaze(complete, {
            cellCount: row.cellCount,
            gateCount: row.gateCount,
          })
        : null;

      await ctx.db
        .update(maze)
        .set({
          data: input.data,
          contentHash: validation?.ok ? validation.contentHash : null,
          optimalMoves: validation?.ok ? validation.optimalMoves : null,
        })
        .where(eq(maze.id, input.id));

      if (validation?.ok) return { valid: true as const, issues: [] };
      return {
        valid: false as const,
        issues: validation?.issues ?? [{ key: "maze.validate.incomplete" as const }],
      };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [found] = await ctx.db
        .select({ id: maze.id })
        .from(maze)
        .where(ownedBy(input.id, ctx.session.user.id));
      assertOwned(found);
      await ctx.db.delete(maze).where(eq(maze.id, input.id));
      return { id: input.id };
    }),
});
```

Register it in `src/server/api/root.ts` alongside `profile`.

- [ ] **Step 6: Add the three new error keys**

`errors.notYourMaze`, `errors.mazeIsSubmitted` and `maze.validate.incomplete` are
emitted above and must resolve. Add to `messages/en.json`:

```json
{
  "errors": {
    "notYourMaze": "That labyrinth is not yours.",
    "mazeIsSubmitted": "This labyrinth has been submitted and can no longer be changed."
  },
  "maze": { "validate": { "incomplete": "Place a start and a treasure to finish." } }
}
```

And `messages/sk.json`:

```json
{
  "errors": {
    "notYourMaze": "Toto bludisko nie je vaše.",
    "mazeIsSubmitted": "Toto bludisko je odoslané a už sa nedá meniť."
  },
  "maze": { "validate": { "incomplete": "Umiestnite štart a poklad a bude hotovo." } }
}
```

Note `maze.validate.incomplete` and `maze.format.cellCountNotAPreset` are
emitted by the router, not by `validateStructure` or the schema, so neither is
in `MAZE_ISSUE_KEYS` or `MAZE_FORMAT_ISSUE_KEYS` and Task 1's resolution test
will not cover them.

Extend that test to cover them explicitly. In
`tests/unit/maze/issue-keys-resolve.test.ts`, change the `allKeys` definition:

```ts
/** Keys emitted outside the unions — by the router, not the domain. */
const ROUTER_KEYS = [
  "maze.validate.incomplete",
  "maze.format.cellCountNotAPreset",
];

const allKeys = [...MAZE_ISSUE_KEYS, ...MAZE_FORMAT_ISSUE_KEYS, ...ROUTER_KEYS];
```

Add copy for `maze.format.cellCountNotAPreset` to both catalogues as well —
English "That is not one of the available sizes." and Slovak "Toto nie je jedna
z dostupných veľkostí."

The honest limitation: `ROUTER_KEYS` is hand-maintained, so a key added to the
router later and forgotten here resolves to nothing silently. That is the same
one-way check Phase 1 flagged on `MAZE_ISSUE_KEYS`. It is acceptable while the
list is two entries long and worth revisiting if it grows.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test:integration tests/integration/maze-router.test.ts`

Expected: PASS, 9 tests.

- [ ] **Step 8: Verify and commit**

```bash
pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
git add -A
git commit -m "$(cat <<'MSG'
feat: add the maze table and its router

Drafts and submitted mazes share one row and one data column, because a draft
becomes the maze rather than being copied into one. Ownership is checked on
every read and write, and the derived columns stay null until the maze actually
validates.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The editor reducer

**Files:**
- Create: `src/maze/editor-state.ts`
- Test: `tests/unit/maze/editor-state.test.ts`

**Interfaces:**
- Consumes: `DraftMaze`, `emptyDraft`, `Point`, `Segment`, `Orientation`, `cellKey`, `edgeKey` from `~/maze`.
- Produces, from `~/maze/editor-state`:
  - `Tool` — `"paint" | "erase-cell" | "wall" | "gate" | "key" | "start" | "treasure" | "erase"`
  - `EditorState` — `{ draft: DraftMaze; past: DraftMaze[]; future: DraftMaze[] }`
  - `EditorAction` — see step 3
  - `initialEditorState(draft: DraftMaze): EditorState`
  - `editorReducer(state: EditorState, action: EditorAction): EditorState`
  - `cellsUsed(draft)`, `gatesPlaced(draft)`, `keysPlaced(draft)`

This is where the editor's behaviour lives. Keeping it a pure reducer is what
makes undo, redo and the budget counter testable without a browser — the
component in Task 6 holds no logic of its own.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/maze/editor-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { emptyDraft } from "~/maze/draft";
import {
  editorReducer,
  initialEditorState,
  cellsUsed,
  gatesPlaced,
  type EditorState,
} from "~/maze/editor-state";

function start(): EditorState {
  return initialEditorState(emptyDraft());
}

function apply(state: EditorState, ...actions: Parameters<typeof editorReducer>[1][]) {
  return actions.reduce(editorReducer, state);
}

describe("painting", () => {
  it("adds a cell", () => {
    const next = editorReducer(start(), { type: "paintCell", at: { x: 1, y: 2 } });
    expect(next.draft.cells).toEqual([{ x: 1, y: 2 }]);
  });

  it("is idempotent — painting the same cell twice adds one", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 1, y: 2 } },
      { type: "paintCell", at: { x: 1, y: 2 } },
    );
    expect(cellsUsed(next.draft)).toBe(1);
  });

  it("erasing a cell removes what was on it", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "paintCell", at: { x: 1, y: 0 } },
      { type: "placeStart", at: { x: 1, y: 0 } },
      { type: "placeSegment", edge: { o: "V", x: 0, y: 0 }, kind: "wall" },
      { type: "eraseCell", at: { x: 1, y: 0 } },
    );
    expect(cellsUsed(next.draft)).toBe(1);
    expect(next.draft.start).toBeNull();
    // The wall had (1,0) on one side, so it goes too.
    expect(next.draft.segments).toEqual([]);
  });
});

describe("placing", () => {
  it("moves the start rather than adding a second", () => {
    const next = apply(
      start(),
      { type: "placeStart", at: { x: 0, y: 0 } },
      { type: "placeStart", at: { x: 2, y: 2 } },
    );
    expect(next.draft.start).toEqual({ x: 2, y: 2 });
  });

  it("numbers gates from 1 upward and pairs a key with each", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "H", x: 0, y: 0 }, kind: "gate" },
      { type: "placeSegment", edge: { o: "H", x: 1, y: 0 }, kind: "gate" },
    );
    expect(next.draft.segments.map((s) => (s.kind === "gate" ? s.gate : null))).toEqual([1, 2]);
    expect(gatesPlaced(next.draft)).toBe(2);
  });

  it("reuses the lowest free gate number after a removal", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "H", x: 0, y: 0 }, kind: "gate" },
      { type: "placeSegment", edge: { o: "H", x: 1, y: 0 }, kind: "gate" },
      { type: "removeSegment", edge: { o: "H", x: 0, y: 0 } },
      { type: "placeSegment", edge: { o: "H", x: 2, y: 0 }, kind: "gate" },
    );
    expect(next.draft.segments.map((s) => (s.kind === "gate" ? s.gate : null)).sort()).toEqual([1, 2]);
  });

  it("removing a gate removes its key too", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "H", x: 0, y: 0 }, kind: "gate" },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 1 },
      { type: "removeSegment", edge: { o: "H", x: 0, y: 0 } },
    );
    expect(next.draft.keys).toEqual([]);
  });

  it("replaces a wall with a gate rather than stacking", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "V", x: 1, y: 1 }, kind: "wall" },
      { type: "placeSegment", edge: { o: "V", x: 1, y: 1 }, kind: "gate" },
    );
    expect(next.draft.segments).toHaveLength(1);
    expect(next.draft.segments[0]?.kind).toBe("gate");
  });

  it("toggles off when the same tool hits the same edge twice", () => {
    // Spec §10.2: "Clicking an existing item with the active tool removes it."
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "V", x: 1, y: 1 }, kind: "wall" },
      { type: "placeSegment", edge: { o: "V", x: 1, y: 1 }, kind: "wall" },
    );
    expect(next.draft.segments).toEqual([]);
  });

  it("toggling a gate off takes its key with it", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "H", x: 0, y: 0 }, kind: "gate" },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 1 },
      { type: "placeSegment", edge: { o: "H", x: 0, y: 0 }, kind: "gate" },
    );
    expect(next.draft.segments).toEqual([]);
    expect(next.draft.keys).toEqual([]);
  });
});

describe("undo and redo", () => {
  it("undoes the last edit", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "paintCell", at: { x: 1, y: 0 } },
      { type: "undo" },
    );
    expect(cellsUsed(next.draft)).toBe(1);
  });

  it("redoes what was undone", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "undo" },
      { type: "redo" },
    );
    expect(cellsUsed(next.draft)).toBe(1);
  });

  it("a new edit discards the redo stack", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "undo" },
      { type: "paintCell", at: { x: 5, y: 5 } },
      { type: "redo" },
    );
    expect(next.draft.cells).toEqual([{ x: 5, y: 5 }]);
  });

  it("undo at the beginning is a no-op, not a crash", () => {
    const next = editorReducer(start(), { type: "undo" });
    expect(next.draft).toEqual(emptyDraft());
  });

  it("does not record history for an edit that changes nothing", () => {
    // Painting an already-painted cell must not cost an undo step, or dragging
    // across one square fills the stack with nothing.
    const once = editorReducer(start(), { type: "paintCell", at: { x: 0, y: 0 } });
    const twice = editorReducer(once, { type: "paintCell", at: { x: 0, y: 0 } });
    expect(twice.past).toHaveLength(once.past.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/maze/editor-state.test.ts`

Expected: FAIL — cannot resolve `~/maze/editor-state`.

- [ ] **Step 3: Write the reducer**

Create `src/maze/editor-state.ts`:

```ts
import type { DraftMaze } from "./draft";
import { MAX_GATES, type Orientation, type Point } from "./format";
import { cellKey, edgeKey, step, type Edge } from "./geometry";

export type Tool =
  | "paint"
  | "erase-cell"
  | "wall"
  | "gate"
  | "key"
  | "start"
  | "treasure"
  | "erase";

export type EditorState = {
  draft: DraftMaze;
  past: DraftMaze[];
  future: DraftMaze[];
};

export type EditorAction =
  | { type: "paintCell"; at: Point }
  | { type: "eraseCell"; at: Point }
  | { type: "placeSegment"; edge: Edge; kind: "wall" | "gate" }
  | { type: "removeSegment"; edge: Edge }
  | { type: "placeKey"; at: Point; gate: number }
  | { type: "removeKey"; at: Point }
  | { type: "placeStart"; at: Point }
  | { type: "placeTreasure"; at: Point }
  | { type: "undo" }
  | { type: "redo" };

export function initialEditorState(draft: DraftMaze): EditorState {
  return { draft, past: [], future: [] };
}

export function cellsUsed(draft: DraftMaze): number {
  return draft.cells.length;
}

export function gatesPlaced(draft: DraftMaze): number {
  return draft.segments.filter((s) => s.kind === "gate").length;
}

export function keysPlaced(draft: DraftMaze): number {
  return draft.keys.length;
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return {
      draft: previous,
      past: state.past.slice(0, -1),
      future: [state.draft, ...state.future],
    };
  }

  if (action.type === "redo") {
    const next = state.future[0];
    if (!next) return state;
    return {
      draft: next,
      past: [...state.past, state.draft],
      future: state.future.slice(1),
    };
  }

  const draft = applyEdit(state.draft, action);

  // An edit that changed nothing must not cost an undo step: dragging across a
  // square that is already painted would otherwise fill the stack with no-ops.
  if (draft === state.draft) return state;

  return { draft, past: [...state.past, state.draft], future: [] };
}

function applyEdit(draft: DraftMaze, action: EditorAction): DraftMaze {
  switch (action.type) {
    case "paintCell": {
      if (draft.cells.some((c) => cellKey(c) === cellKey(action.at))) return draft;
      return { ...draft, cells: [...draft.cells, action.at] };
    }

    case "eraseCell": {
      const gone = cellKey(action.at);
      if (!draft.cells.some((c) => cellKey(c) === gone)) return draft;

      // Anything that referenced the square goes with it, or the draft would
      // hold a wall with nothing on one side and a start in empty space.
      const cells = draft.cells.filter((c) => cellKey(c) !== gone);
      const segments = draft.segments.filter(
        (s) => !touches(s, action.at),
      );
      const survivingGates = new Set(
        segments.filter((s) => s.kind === "gate").map((s) => s.gate),
      );

      return {
        ...draft,
        cells,
        segments,
        keys: draft.keys.filter(
          (k) => cellKey(k) !== gone && survivingGates.has(k.gate),
        ),
        start: draft.start && cellKey(draft.start) === gone ? null : draft.start,
        treasure:
          draft.treasure && cellKey(draft.treasure) === gone ? null : draft.treasure,
      };
    }

    case "placeSegment": {
      const id = edgeKey(action.edge);
      const existing = draft.segments.find((s) => edgeKey(s) === id);

      // Spec §10.2: the active tool toggles. Clicking a wall with the wall
      // tool removes it; clicking it with the gate tool replaces it.
      if (existing?.kind === action.kind) {
        return applyEdit(draft, { type: "removeSegment", edge: action.edge });
      }

      const without = draft.segments.filter((s) => edgeKey(s) !== id);
      const removedGate = existing?.kind === "gate" ? existing : undefined;

      if (action.kind === "wall") {
        return {
          ...draft,
          segments: [...without, { ...action.edge, kind: "wall" }],
          keys: removedGate
            ? draft.keys.filter((k) => k.gate !== removedGate.gate)
            : draft.keys,
        };
      }

      const gate = lowestFreeGate(without);
      if (gate === null) return draft;

      return {
        ...draft,
        segments: [...without, { ...action.edge, kind: "gate", gate }],
        keys: removedGate
          ? draft.keys.filter((k) => k.gate !== removedGate.gate)
          : draft.keys,
      };
    }

    case "removeSegment": {
      const id = edgeKey(action.edge);
      const removed = draft.segments.find((s) => edgeKey(s) === id);
      if (!removed) return draft;

      return {
        ...draft,
        segments: draft.segments.filter((s) => edgeKey(s) !== id),
        keys:
          removed.kind === "gate"
            ? draft.keys.filter((k) => k.gate !== removed.gate)
            : draft.keys,
      };
    }

    case "placeKey": {
      const at = cellKey(action.at);
      return {
        ...draft,
        keys: [
          ...draft.keys.filter((k) => cellKey(k) !== at && k.gate !== action.gate),
          { gate: action.gate, x: action.at.x, y: action.at.y },
        ],
      };
    }

    case "removeKey": {
      const at = cellKey(action.at);
      if (!draft.keys.some((k) => cellKey(k) === at)) return draft;
      return { ...draft, keys: draft.keys.filter((k) => cellKey(k) !== at) };
    }

    case "placeStart":
      return { ...draft, start: action.at };

    case "placeTreasure":
      return { ...draft, treasure: action.at };

    default:
      return draft;
  }
}

/** True when one of the edge's two cells is `at`. */
function touches(edge: { o: Orientation; x: number; y: number }, at: Point): boolean {
  const here = { x: edge.x, y: edge.y };
  const other = edge.o === "H" ? step(here, "S") : step(here, "E");
  return cellKey(here) === cellKey(at) || cellKey(other) === cellKey(at);
}

/** The smallest gate id not already in use, or null when all 8 are taken. */
function lowestFreeGate(segments: DraftMaze["segments"]): number | null {
  const used = new Set(
    segments.filter((s) => s.kind === "gate").map((s) => s.gate),
  );
  for (let id = 1; id <= MAX_GATES; id += 1) {
    if (!used.has(id)) return id;
  }
  return null;
}
```

Re-export from the barrel: add `export * from "./editor-state";` to `src/maze/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/maze/editor-state.test.ts`

Expected: PASS, 12 tests.

- [ ] **Step 5: Verify the purity rule still holds**

The reducer lives in `src/maze/`, so the boundary applies to it. Confirm it fires:

```bash
cat > src/maze/boundary-probe.ts <<'PROBE'
import { useReducer } from "react";
export const probe = useReducer;
PROBE
pnpm lint 2>&1 | grep -q "must stay pure" && echo "RULE FIRES" || echo "RULE DID NOT FIRE"
rm src/maze/boundary-probe.ts
```

Expected: `RULE FIRES`, and `git status` clean of the probe.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
git add -A
git commit -m "$(cat <<'MSG'
feat: add the pure editor reducer

Every edit is an action and undo is a stack of states, which puts the editor's
behaviour in Vitest rather than in a browser. Erasing a square takes everything
that referenced it, gates take their keys with them, and an edit that changes
nothing costs no undo step.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The SVG board

**Files:**
- Create: `src/components/editor/board.tsx`
- Modify: `src/styles/globals.css`
- Test: none of its own — see the note below

**Interfaces:**
- Consumes: `DraftMaze`, `Point`, `Edge`, `edgeKey`, `cellKey` from `~/maze`.
- Produces: `<Board draft={...} onCell={...} onEdge={...} edgesActive={...} />` and the constants `CELL_PX = 40`, `FRAME = 16`. Every cell carries `data-cell="x,y"` and every edge `data-edge="H:x,y"`.

**On testing this task.** The board renders nothing until a page mounts it, and
that page arrives in Task 8. Rather than write an end-to-end test here that
cannot pass until three tasks later — a red suite is not an independently
testable deliverable — the board's assertions live in Task 8's spec alongside
the editor's. This task is verified by typecheck, lint and build, and the
component is read rather than run.

That is a deliberate exception to the usual rule, and it is the only one in this
plan.

- [ ] **Step 3: Add the board's colour tokens**

In `src/styles/globals.css`, add to `:root`:

```css
  --cell-painted: oklch(93% 0 0);
  --cell-void: oklch(97% 0 0);
  --grid-line: oklch(88% 0 0);
  --wall: oklch(25% 0 0);
```

and to `:root[data-theme="dark"]`:

```css
  --cell-painted: oklch(30% 0 0);
  --cell-void: oklch(21% 0 0);
  --grid-line: oklch(27% 0 0);
  --wall: oklch(88% 0 0);
```

and to the `@theme inline` block:

```css
  --color-cell-painted: var(--cell-painted);
  --color-cell-void: var(--cell-void);
  --color-grid-line: var(--grid-line);
  --color-wall: var(--wall);
```

Gate colours reuse `--color-accent` and `--color-danger` with a hue rotation per
gate id, applied inline from the gate number — eight gates, eight hues.

- [ ] **Step 4: Write the board**

Create `src/components/editor/board.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";

import { cellKey, edgeKey, type DraftMaze, type Edge, type Point } from "~/maze";

export const FRAME = 16;
export const CELL_PX = 40;
/** Invisible hit strip for an edge. A wall is one pixel; this is what you click. */
const EDGE_HIT = 14;

const GATE_HUES = [25, 70, 140, 190, 260, 300, 340, 10];

function gateColour(gate: number): string {
  return `oklch(60% 0.18 ${GATE_HUES[(gate - 1) % GATE_HUES.length]})`;
}

export type BoardProps = {
  draft: DraftMaze;
  onCell: (at: Point) => void;
  onEdge: (edge: Edge) => void;
  /** Edges are only clickable when the active tool places something on one. */
  edgesActive: boolean;
};

export function Board({ draft, onCell, onEdge, edgesActive }: BoardProps) {
  const t = useTranslations("editor");
  const painted = new Set(draft.cells.map(cellKey));
  const keyAt = new Map(draft.keys.map((k) => [cellKey(k), k.gate]));

  const cells: Point[] = [];
  for (let y = 0; y < FRAME; y += 1) {
    for (let x = 0; x < FRAME; x += 1) cells.push({ x, y });
  }

  return (
    <svg
      data-board
      role="group"
      aria-label={t("boardLabel")}
      viewBox={`0 0 ${FRAME * CELL_PX} ${FRAME * CELL_PX}`}
      className="border-border-strong h-auto w-full max-w-[700px] rounded border"
    >
      {cells.map((at) => (
        <rect
          key={cellKey(at)}
          data-cell={`${at.x},${at.y}`}
          x={at.x * CELL_PX}
          y={at.y * CELL_PX}
          width={CELL_PX}
          height={CELL_PX}
          className={
            painted.has(cellKey(at))
              ? "fill-cell-painted stroke-grid-line"
              : "fill-cell-void stroke-grid-line"
          }
          strokeWidth={1}
          onClick={() => onCell(at)}
        />
      ))}

      {draft.start && (
        <circle
          data-start
          cx={(draft.start.x + 0.5) * CELL_PX}
          cy={(draft.start.y + 0.5) * CELL_PX}
          r={CELL_PX * 0.3}
          className="fill-accent"
        />
      )}

      {draft.treasure && (
        <rect
          data-treasure
          x={(draft.treasure.x + 0.25) * CELL_PX}
          y={(draft.treasure.y + 0.25) * CELL_PX}
          width={CELL_PX * 0.5}
          height={CELL_PX * 0.5}
          className="fill-danger"
        />
      )}

      {[...keyAt].map(([at, gate]) => {
        const [x, y] = at.split(",").map(Number) as [number, number];
        return (
          <circle
            key={`key-${at}`}
            data-key={gate}
            cx={(x + 0.5) * CELL_PX}
            cy={(y + 0.5) * CELL_PX}
            r={CELL_PX * 0.18}
            fill={gateColour(gate)}
          />
        );
      })}

      {draft.segments.map((segment) => {
        const horizontal = segment.o === "H";
        const x1 = segment.x * CELL_PX;
        const y1 = (segment.y + (horizontal ? 1 : 0)) * CELL_PX;
        const x2 = (segment.x + (horizontal ? 1 : 0)) * CELL_PX;
        const y2 = (segment.y + 1) * CELL_PX;

        return (
          <line
            key={`seg-${edgeKey(segment)}`}
            data-segment={edgeKey(segment)}
            x1={horizontal ? x1 : x2}
            y1={y1}
            x2={horizontal ? x1 + CELL_PX : x2}
            y2={horizontal ? y1 : y2}
            strokeWidth={4}
            strokeLinecap="round"
            className={segment.kind === "wall" ? "stroke-wall" : undefined}
            stroke={segment.kind === "gate" ? gateColour(segment.gate) : undefined}
          />
        );
      })}

      {edgesActive &&
        edgesOf().map((edge) => {
          const horizontal = edge.o === "H";
          return (
            <rect
              key={`hit-${edgeKey(edge)}`}
              data-edge={edgeKey(edge)}
              x={edge.x * CELL_PX + (horizontal ? 0 : CELL_PX - EDGE_HIT / 2)}
              y={edge.y * CELL_PX + (horizontal ? CELL_PX - EDGE_HIT / 2 : 0)}
              width={horizontal ? CELL_PX : EDGE_HIT}
              height={horizontal ? EDGE_HIT : CELL_PX}
              fill="transparent"
              onClick={() => onEdge(edge)}
            />
          );
        })}
    </svg>
  );
}

/** Every interior edge of the frame, each with its one legal spelling. */
function edgesOf(): Edge[] {
  const edges: Edge[] = [];
  for (let y = 0; y < FRAME; y += 1) {
    for (let x = 0; x < FRAME; x += 1) {
      if (y < FRAME - 1) edges.push({ o: "H", x, y });
      if (x < FRAME - 1) edges.push({ o: "V", x, y });
    }
  }
  return edges;
}
```

Add to `messages/en.json` under `editor`: `"boardLabel": "Labyrinth board"`.
Add to `messages/sk.json`: `"boardLabel": "Plocha bludiska"`.

- [ ] **Step 5: Commit**

The board cannot be exercised until Task 8 renders it, so there is nothing to run
beyond the static checks.

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
git add -A
git commit -m "$(cat <<'MSG'
feat: add the SVG editor board

Every square and every edge is an addressable DOM node, so a test clicks
[data-edge="H:3,4"] rather than computing pixel offsets. Edge hit strips are 14
units wide around a 4-unit line, because a wall you cannot click is a wall you
cannot draw.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: Shape mode

**Files:**
- Create: `src/components/editor/shape-tools.tsx`
- Modify: `messages/en.json`, `messages/sk.json`
- Test: covered by `e2e/editor.spec.ts` in Task 8

**Interfaces:**
- Consumes: `Tool`, `cellsUsed` from `~/maze`.
- Produces: `<ShapeTools tool={...} onTool={...} used={...} budget={...} />`.

- [ ] **Step 1: Write the component**

Create `src/components/editor/shape-tools.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";

import type { Tool } from "~/maze";

export type ShapeToolsProps = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  used: number;
  budget: number;
};

export function ShapeTools({ tool, onTool, used, budget }: ShapeToolsProps) {
  const t = useTranslations("editor");

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={tool === "paint"}
          onClick={() => onTool("paint")}
          className={buttonClass(tool === "paint")}
        >
          {t("paint")}
        </button>
        <button
          type="button"
          aria-pressed={tool === "erase-cell"}
          onClick={() => onTool("erase-cell")}
          className={buttonClass(tool === "erase-cell")}
        >
          {t("eraseCell")}
        </button>
      </div>

      <p data-budget className="text-sm">
        {t("budget", { used, budget })}
      </p>
    </div>
  );
}

function buttonClass(active: boolean): string {
  return active
    ? "bg-accent text-on-accent rounded px-3 py-2 text-sm"
    : "border-border-strong rounded border px-3 py-2 text-sm";
}
```

- [ ] **Step 2: Add the copy**

`messages/en.json` under `editor`:

```json
{
  "paint": "Paint",
  "eraseCell": "Erase square",
  "budget": "{used} / {budget} squares"
}
```

`messages/sk.json` under `editor`:

```json
{
  "paint": "Kresliť",
  "eraseCell": "Zmazať políčko",
  "budget": "{used} / {budget} políčok"
}
```

- [ ] **Step 3: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
git add -A
git commit -m "$(cat <<'MSG'
feat: add shape-mode tools

Paint and erase against a live budget counter. The counter reports a fact and
no judgement, per spec section 4.3.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Detail mode and the validation panel

**Files:**
- Create: `src/components/editor/detail-tools.tsx`, `src/components/editor/validation-panel.tsx`
- Modify: `messages/en.json`, `messages/sk.json`
- Test: `tests/unit/maze/issue-rendering.test.ts`

**Interfaces:**
- Consumes: `Tool`, `TranslatableIssue`, `gatesPlaced`, `keysPlaced`.
- Produces: `<DetailTools tool={...} onTool={...} gates={...} gateBudget={...} />` and `<ValidationPanel issues={...} valid={...} />`.

The panel is where Phase 1's error contract finally reaches a human. It renders
each issue by looking its key up in the catalogue and interpolating the params —
never by printing the key or any English fallback.

- [ ] **Step 1: Write the failing test**

Issue rendering is pure, so it is a unit test, not a browser one. Create
`tests/unit/maze/issue-rendering.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import { MAZE_ISSUE_KEYS } from "~/maze";

type Catalogue = Record<string, unknown>;

function lookup(catalogue: Catalogue, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Catalogue)[part]
          : undefined,
      catalogue,
    );
  return typeof value === "string" ? value : undefined;
}

/** Every {name} placeholder in a message. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe("issue copy and the params the code supplies", () => {
  // The params each key is emitted with, read from src/maze/validate.ts and
  // src/maze/index.ts. If a key gains or loses a param, this list must change
  // with it — which is the point.
  const expected: Record<string, string[]> = {
    "maze.validate.wrongCellCount": ["actual", "expected"],
    "maze.validate.boundingBoxTooLarge": ["height", "max", "width"],
    "maze.validate.keyOutsideShape": ["gate"],
    "maze.validate.cellHoldsTwoThings": ["x", "y"],
    "maze.validate.segmentOutsideShape": ["o", "x", "y"],
    "maze.validate.duplicateSegment": ["o", "x", "y"],
    "maze.validate.gateIdsNotContiguous": ["expected"],
    "maze.validate.gateWithoutKey": ["gate"],
    "maze.validate.gateWithTwoKeys": ["gate"],
    "maze.validate.keyWithoutGate": ["gate"],
  };

  it.each(MAZE_ISSUE_KEYS)("%s interpolates only params the code sends", (key) => {
    const message = lookup(en as Catalogue, key);
    expect(message).toBeDefined();
    const used = placeholders(message!);
    const supplied = expected[key] ?? [];
    // A placeholder with no matching param renders as a literal brace to the
    // user — worse than plain copy, because it looks like a bug.
    expect(used.filter((p) => !supplied.includes(p))).toEqual([]);
  });

  it("uses every param the code bothers to send", () => {
    // Not an error, but a param nobody renders is copy that could be clearer.
    for (const [key, params] of Object.entries(expected)) {
      const message = lookup(en as Catalogue, key);
      expect(message, key).toBeDefined();
      const used = placeholders(message!);
      expect(params.filter((p) => !used.includes(p)), key).toEqual([]);
    }
  });

  it("boundingBoxTooLarge may reuse a placeholder", () => {
    // "{max} by {max}" is legitimate; the matcher must not treat the repeat as
    // an unused param.
    expect(lookup(en as Catalogue, "maze.validate.boundingBoxTooLarge")).toContain("{max}");
  });
});
```

- [ ] **Step 2: Run it to verify it fails or passes honestly**

Run: `pnpm test tests/unit/maze/issue-rendering.test.ts`

Expected: PASS if Task 1's copy is right, FAIL naming the mismatched key if not.
Either outcome is information — if it fails, fix the copy, not the test.

- [ ] **Step 3: Write the detail palette**

Create `src/components/editor/detail-tools.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";

import type { Tool } from "~/maze";

export type DetailToolsProps = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  gates: number;
  gateBudget: number;
  keys: number;
};

const TOOLS: { tool: Tool; key: string }[] = [
  { tool: "wall", key: "wall" },
  { tool: "gate", key: "gate" },
  { tool: "key", key: "key" },
  { tool: "start", key: "start" },
  { tool: "treasure", key: "treasure" },
  { tool: "erase", key: "erase" },
];

export function DetailTools({
  tool,
  onTool,
  gates,
  gateBudget,
  keys,
}: DetailToolsProps) {
  const t = useTranslations("editor");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TOOLS.map(({ tool: option, key }) => (
          <button
            key={option}
            type="button"
            aria-pressed={tool === option}
            onClick={() => onTool(option)}
            className={
              tool === option
                ? "bg-accent text-on-accent rounded px-3 py-2 text-sm"
                : "border-border-strong rounded border px-3 py-2 text-sm"
            }
          >
            {t(key)}
          </button>
        ))}
      </div>

      <p data-gates className="text-sm">
        {t("gates", { gates, gateBudget })}
      </p>
      <p data-keys className="text-sm">
        {t("keys", { keys })}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Write the validation panel**

Create `src/components/editor/validation-panel.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";

import type { TranslatableIssue } from "~/lib/issues";

export type ValidationPanelProps = {
  issues: TranslatableIssue[];
  valid: boolean;
};

export function ValidationPanel({ issues, valid }: ValidationPanelProps) {
  const t = useTranslations();

  if (valid) {
    return (
      <p data-validity="valid" className="text-sm">
        {t("editor.valid")}
      </p>
    );
  }

  return (
    <div data-validity="invalid" className="space-y-2">
      <p className="text-sm font-medium">{t("editor.notYetValid")}</p>
      <ul className="text-danger space-y-1 text-sm">
        {issues.map((issue, index) => (
          <li key={`${issue.key}-${index}`} data-issue={issue.key}>
            {/* The key is translated with its params. Neither the key nor any
                English fallback is ever shown — that is the whole contract. */}
            {t(issue.key as never, issue.params as never)}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Add the copy**

`messages/en.json` under `editor`:

```json
{
  "wall": "Wall",
  "gate": "Gate",
  "key": "Key",
  "start": "Start",
  "treasure": "Treasure",
  "erase": "Erase",
  "gates": "{gates} / {gateBudget} gates",
  "keys": "{keys} keys placed",
  "valid": "This labyrinth is ready to submit.",
  "notYetValid": "Not ready yet:"
}
```

`messages/sk.json` under `editor`:

```json
{
  "wall": "Stena",
  "gate": "Brána",
  "key": "Kľúč",
  "start": "Štart",
  "treasure": "Poklad",
  "erase": "Guma",
  "gates": "{gates} / {gateBudget} brán",
  "keys": "{keys} umiestnených kľúčov",
  "valid": "Toto bludisko je pripravené na odoslanie.",
  "notYetValid": "Ešte nie je hotové:"
}
```

- [ ] **Step 6: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
git add -A
git commit -m "$(cat <<'MSG'
feat: add the detail palette and the validation panel

The panel is where Phase 1's error contract reaches a human: each issue is
translated from its key with its params, and a unit test asserts the copy's
placeholders match the params the code actually sends.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The editor, wired

**Files:**
- Create: `src/components/editor/maze-editor.tsx`
- Modify: `messages/en.json`, `messages/sk.json`
- Test: covered by `e2e/editor.spec.ts` in Task 8

**Interfaces:**
- Consumes: everything from Tasks 3–6, plus `api.maze.saveDraft` from `~/trpc/react`.
- Produces: `<MazeEditor id={...} initial={...} cellCount={...} gateCount={...} />`.

- [ ] **Step 1: Write the component**

Create `src/components/editor/maze-editor.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useReducer, useRef, useState } from "react";

import type { TranslatableIssue } from "~/lib/issues";
import {
  cellsUsed,
  draftToMaze,
  editorReducer,
  gatesPlaced,
  initialEditorState,
  keysPlaced,
  validateMaze,
  type DraftMaze,
  type Edge,
  type Point,
  type Tool,
} from "~/maze";
import { api } from "~/trpc/react";
import { Board } from "./board";
import { DetailTools } from "./detail-tools";
import { ShapeTools } from "./shape-tools";
import { ValidationPanel } from "./validation-panel";

const AUTOSAVE_MS = 800;

export type MazeEditorProps = {
  id: string;
  initial: DraftMaze;
  cellCount: number;
  gateCount: number;
};

export function MazeEditor({ id, initial, cellCount, gateCount }: MazeEditorProps) {
  const t = useTranslations("editor");
  const [state, dispatch] = useReducer(editorReducer, initial, initialEditorState);
  const [tool, setTool] = useState<Tool>("paint");
  const saveDraft = api.maze.saveDraft.useMutation();
  const lastSaved = useRef<DraftMaze>(initial);

  // Autosave. Losing a half-drawn labyrinth to a refresh is the kind of thing
  // that ends someone's interest in an app (spec §10.2), so the debounce is
  // short and every settled edit is written.
  useEffect(() => {
    if (state.draft === lastSaved.current) return;
    const timer = setTimeout(() => {
      lastSaved.current = state.draft;
      saveDraft.mutate({ id, data: state.draft });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [state.draft, id, saveDraft]);

  const complete = draftToMaze(state.draft);
  const validation = complete
    ? validateMaze(complete, { cellCount, gateCount })
    : null;
  const issues: TranslatableIssue[] = validation
    ? validation.ok
      ? []
      : validation.issues
    : [{ key: "maze.validate.incomplete" }];

  function onCell(at: Point) {
    switch (tool) {
      case "paint":
        return dispatch({ type: "paintCell", at });
      case "erase-cell":
        return dispatch({ type: "eraseCell", at });
      case "start":
        return dispatch({ type: "placeStart", at });
      case "treasure":
        return dispatch({ type: "placeTreasure", at });
      case "key": {
        const gate = nextKeylessGate(state.draft);
        return gate === null ? undefined : dispatch({ type: "placeKey", at, gate });
      }
      case "erase":
        return dispatch({ type: "removeKey", at });
      default:
        return undefined;
    }
  }

  function onEdge(edge: Edge) {
    if (tool === "wall") return dispatch({ type: "placeSegment", edge, kind: "wall" });
    if (tool === "gate") return dispatch({ type: "placeSegment", edge, kind: "gate" });
    if (tool === "erase") return dispatch({ type: "removeSegment", edge });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Board
        draft={state.draft}
        onCell={onCell}
        onEdge={onEdge}
        edgesActive={tool === "wall" || tool === "gate" || tool === "erase"}
      />

      <aside className="space-y-6">
        <ShapeTools
          tool={tool}
          onTool={setTool}
          used={cellsUsed(state.draft)}
          budget={cellCount}
        />
        <DetailTools
          tool={tool}
          onTool={setTool}
          gates={gatesPlaced(state.draft)}
          gateBudget={gateCount}
          keys={keysPlaced(state.draft)}
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: "undo" })}
            disabled={state.past.length === 0}
            className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
          >
            {t("undo")}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "redo" })}
            disabled={state.future.length === 0}
            className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
          >
            {t("redo")}
          </button>
        </div>

        <ValidationPanel issues={issues} valid={validation?.ok === true} />
      </aside>
    </div>
  );
}

/** The lowest gate id that has no key yet, so the key tool knows what to place. */
function nextKeylessGate(draft: DraftMaze): number | null {
  const withKeys = new Set(draft.keys.map((k) => k.gate));
  const gates = draft.segments
    .filter((s) => s.kind === "gate")
    .map((s) => s.gate)
    .sort((a, b) => a - b);
  return gates.find((g) => !withKeys.has(g)) ?? null;
}
```

- [ ] **Step 2: Add the copy**

`messages/en.json` under `editor`: `"undo": "Undo"`, `"redo": "Redo"`.
`messages/sk.json` under `editor`: `"undo": "Späť"`, `"redo": "Dopredu"`.

- [ ] **Step 3: Verify and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
git add -A
git commit -m "$(cat <<'MSG'
feat: wire the maze editor

The component holds no logic beyond routing clicks to reducer actions: the
reducer owns the edits, the domain owns validation, and autosave writes every
settled change.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The pages, and the end-to-end proof

**Files:**
- Create: `src/app/[locale]/(app)/labyrinths/page.tsx`, `src/app/[locale]/(app)/labyrinths/[id]/page.tsx`, `src/components/editor/new-maze-form.tsx`, `src/components/editor/maze-list.tsx`
- Modify: `messages/en.json`, `messages/sk.json`
- Test: `e2e/editor.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces: the routes `/[locale]/labyrinths` and `/[locale]/labyrinths/[id]`.

- [ ] **Step 1: Write the failing test**

Create `e2e/editor.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { signUpAndOpenNewMaze } from "./support/maze";

test.describe("drawing a labyrinth", () => {
  test("paints squares and counts them against the budget", async ({ page }) => {
    await signUpAndOpenNewMaze(page);

    await expect(page.locator("[data-budget]")).toHaveText("0 / 36 squares");
    await page.locator('[data-cell="0,0"]').click();
    await page.locator('[data-cell="1,0"]').click();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");

    // Painting the same square again changes nothing.
    await page.locator('[data-cell="1,0"]').click();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");
  });

  test("undo and redo walk the history", async ({ page }) => {
    await signUpAndOpenNewMaze(page);
    await page.locator('[data-cell="0,0"]').click();
    await page.locator('[data-cell="1,0"]').click();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");

    await page.getByRole("button", { name: "Redo" }).click();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");
  });

  test("shows a translated reason while the maze is not valid", async ({ page }) => {
    await signUpAndOpenNewMaze(page);
    await page.locator('[data-cell="0,0"]').click();

    const panel = page.locator('[data-validity="invalid"]');
    await expect(panel).toBeVisible();
    // The issue is rendered as copy, never as a raw key.
    await expect(panel).not.toContainText("maze.validate");
    await expect(panel).toContainText("Place a start and a treasure");
  });

  test("a drawing survives a page refresh", async ({ page }) => {
    await signUpAndOpenNewMaze(page);

    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/trpc/maze.saveDraft") && r.status() === 200,
    );
    await page.locator('[data-cell="3,3"]').click();
    await saved;

    await page.reload();
    await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");
  });

  test("the list shows a saved labyrinth and can delete it", async ({ page }) => {
    await signUpAndOpenNewMaze(page);
    await page.goto("/en/labyrinths");

    await expect(page.getByRole("link", { name: "Test maze" })).toBeVisible();
    await page.getByRole("button", { name: "Delete Test maze" }).click();
    await expect(page.getByRole("link", { name: "Test maze" })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm e2e --project=desktop e2e/editor.spec.ts`

Expected: FAIL — `/en/labyrinths` 404s.

- [ ] **Step 3: Write the list components**

Create `src/components/editor/new-maze-form.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { CELL_COUNT_PRESETS, MAX_GATES } from "~/maze";
import { useRouter } from "~/i18n/navigation";
import { api } from "~/trpc/react";

export function NewMazeForm() {
  const t = useTranslations("labyrinths");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const create = api.maze.createDraft.useMutation({
    onSuccess: ({ id }) => router.push(`/labyrinths/${id}`),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm"
      >
        {t("new")}
      </button>
    );
  }

  return (
    <form
      className="border-border-strong space-y-3 rounded border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        create.mutate({
          name: String(data.get("name")),
          cellCount: Number(data.get("cellCount")) as (typeof CELL_COUNT_PRESETS)[number],
          gateCount: Number(data.get("gateCount")),
        });
      }}
    >
      <label className="block space-y-1">
        <span className="text-sm">{t("name")}</span>
        <input
          name="name"
          required
          maxLength={80}
          className="border-border-strong bg-bg w-full rounded border px-3 py-2"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm">{t("squares")}</span>
        <select
          name="cellCount"
          defaultValue={CELL_COUNT_PRESETS[0]}
          className="border-border-strong bg-bg w-full rounded border px-3 py-2"
        >
          {CELL_COUNT_PRESETS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm">{t("gates")}</span>
        <input
          name="gateCount"
          type="number"
          min={0}
          max={MAX_GATES}
          defaultValue={2}
          className="border-border-strong bg-bg w-full rounded border px-3 py-2"
        />
      </label>

      <button
        type="submit"
        disabled={create.isPending}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
      >
        {t("create")}
      </button>
    </form>
  );
}
```

Create `src/components/editor/maze-list.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";

import { Link } from "~/i18n/navigation";
import { api } from "~/trpc/react";

export function MazeList() {
  const t = useTranslations("labyrinths");
  const utils = api.useUtils();
  const { data } = api.maze.list.useQuery();
  const remove = api.maze.remove.useMutation({
    onSuccess: () => utils.maze.list.invalidate(),
  });

  if (!data || data.length === 0) {
    return <p className="text-muted text-sm">{t("empty")}</p>;
  }

  return (
    <ul className="divide-border divide-y">
      {data.map((item) => (
        <li key={item.id} className="flex items-center justify-between py-3">
          <Link href={`/labyrinths/${item.id}`} className="underline">
            {item.name}
          </Link>
          <span className="text-muted text-sm">
            {t("summary", { squares: item.cellCount, gates: item.gateCount })}
          </span>
          <button
            type="button"
            aria-label={t("delete", { name: item.name })}
            onClick={() => remove.mutate({ id: item.id })}
            className="text-danger text-sm underline"
          >
            {t("deleteShort")}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Write the pages**

Create `src/app/[locale]/(app)/labyrinths/page.tsx`:

```tsx
import { useTranslations } from "next-intl";

import { MazeList } from "~/components/editor/maze-list";
import { NewMazeForm } from "~/components/editor/new-maze-form";

export default function LabyrinthsPage() {
  const t = useTranslations("labyrinths");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-3xl font-bold">{t("title")}</h1>
      <NewMazeForm />
      <MazeList />
    </main>
  );
}
```

Create `src/app/[locale]/(app)/labyrinths/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";

import { MazeEditor } from "~/components/editor/maze-editor";
import { draftMazeSchema } from "~/maze";
import { api } from "~/trpc/server";

export default async function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const row = await api.maze.get({ id }).catch(() => null);
  if (!row) notFound();

  const parsed = draftMazeSchema.safeParse(row.data);
  if (!parsed.success) notFound();

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">{row.name}</h1>
      <MazeEditor
        id={row.id}
        initial={parsed.data}
        cellCount={row.cellCount}
        gateCount={row.gateCount}
      />
    </main>
  );
}
```

Both sit inside the `(app)` route group, so the sign-in redirect from Phase 0
already protects them — do not add a second session check.

- [ ] **Step 5: Add the copy**

`messages/en.json`:

```json
{
  "labyrinths": {
    "title": "Your labyrinths",
    "new": "New labyrinth",
    "name": "Name",
    "squares": "Squares",
    "gates": "Gates",
    "create": "Create",
    "empty": "You have not drawn any labyrinths yet.",
    "summary": "{squares} squares, {gates} gates",
    "delete": "Delete {name}",
    "deleteShort": "Delete"
  }
}
```

`messages/sk.json`:

```json
{
  "labyrinths": {
    "title": "Vaše bludiská",
    "new": "Nové bludisko",
    "name": "Názov",
    "squares": "Políčka",
    "gates": "Brány",
    "create": "Vytvoriť",
    "empty": "Zatiaľ ste nenakreslili žiadne bludisko.",
    "summary": "{squares} políčok, {gates} brán",
    "delete": "Zmazať {name}",
    "deleteShort": "Zmazať"
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm e2e e2e/editor.spec.ts e2e/board.spec.ts`

Expected: PASS, 14 tests (7 specs × 2 projects).

- [ ] **Step 7: Full verification and commit**

```bash
pnpm test && pnpm test:integration && pnpm e2e && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
git add -A
git commit -m "$(cat <<'MSG'
feat: add the labyrinths list and the editor page

A person can now create a labyrinth, draw it, watch the validator report what
is still missing in their own language, and come back to it after a refresh.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Phase 2 exit criteria

- [ ] A signed-in person can create a labyrinth, paint a shape, place walls,
      gates, keys, a start and a treasure, and see the square counter update.
- [ ] Undo and redo work, and an edit that changes nothing costs no undo step.
- [ ] The validation panel renders every issue as translated copy, in both
      languages, never as a raw key.
- [ ] A drawing survives a page refresh.
- [ ] The list shows a person's own labyrinths and nobody else's.
- [ ] Every `maze.*` key resolves in both catalogues, asserted by a test.
- [ ] `pnpm test`, `pnpm test:integration`, `pnpm e2e`, `pnpm typecheck`,
      `pnpm lint`, `pnpm format:check` and `pnpm build` all pass.

## Deliberately not in this phase

- **Submitting a maze.** `status` stays `draft`; Phase 3 owns submission, because
  submission only means something once a match exists to submit into.
- **Drag-to-paint and drag-to-lay-walls.** Spec §10.2 asks for both. Click-per-cell
  is the correct first increment: the reducer already treats a repeated edit as a
  no-op, which is exactly what a drag needs, so the gesture is a component
  concern to add once the editor is otherwise proven.
- **Pinch-zoom and pan.** The board is a fixed 16 × 16 frame scaled to its
  container. Spec §10.2 names phone ergonomics as a known gap with a native
  client as the intended answer.
- **Reusing a submitted maze in a new match.** Phase 3.
