# Labyrinth Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filters and sorting on `/labyrinths`, a shared tile, a 10-labyrinth cap, deletable used labyrinths, and replays that expire 30 days after a match ends.

**Architecture:** Two new columns (`maze.deletedAt`, `match.endedAt`) and a relaxed foreign key carry all new state; labyrinth state (draft/ready/used) stays derived. The time rules are pure functions in `src/match/`, the cap and state in `src/maze/`. The nightly cron gains a purge step. Filtering and sorting happen in the browser over `maze.list`.

**Tech Stack:** Next.js App Router, tRPC, Drizzle on Neon (`neon-serverless` Pool), next-intl, Tailwind v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-labyrinth-library-design.md`

## Global Constraints

- Every rule in `AGENTS.md` (invariants 1–12) holds. Re-check invariant 1 by hand on every procedure touched, per `src/server/api/routers/AGENTS.md`.
- Every new string in both `messages/en.json` and `messages/sk.json`; errors travel as i18n keys with params.
- Colours only from tokens in `src/styles/globals.css`.
- `MAZE_LIMIT = 10`, counting every non-deleted labyrinth of the author.
- `REPLAY_RETENTION_DAYS = 30`, measured as 30 × 24 h from `match.endedAt`.
- Migrations are additive (expand-then-contract): nothing the running code reads is dropped or renamed.
- No pagination.
- Tile width `w-40 sm:w-44` everywhere.
- State labels: en Drafts / Ready / Used, sk Koncepty / Pripravené / Použité.
- `pnpm` only. Write the failing test first and watch it fail.
- e2e: the Playwright config reuses any server on port 3000; if a dev server is running there, the seeding helpers 404. Stop it before `pnpm e2e`.

## Review Focus

1. Two tabs creating the 10th labyrinth at the same moment → exactly one succeeds. (Task 3)
2. Deleting a used labyrinth while a match using it is still running → moves, watch and result keep working. (Task 4)
3. A labyrinth used in an old match and a recent one → not purged until the recent one is past 30 days. (Task 6)
4. A result screen whose `match_player.mazeId` became null after purge → renders scores and the deleted note, no crash. (Task 6)
5. A size filter set to a value the player no longer owns after a delete → falls back to "Any" instead of showing an unexplained empty list. (Task 9)

---

### Task 0: Commit the work already in the tree

**Files:** the uncommitted picker/hover changes, `e2e/lobby.spec.ts`, `e2e/appearance.spec.ts`, both catalogues, the spec and this plan.

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test` — all pass.
- [ ] **Step 2:** With port 3000 free, `pnpm e2e e2e/lobby.spec.ts e2e/appearance.spec.ts e2e/match.spec.ts` — all pass.
- [ ] **Step 3: Commit** as two commits: `fix: the use button appears only once a labyrinth is picked, and a picked one can be cleared` (code + tests + copy + hover CSS), then `docs: labyrinth library design and plan`.

### Task 1: Schema — `deletedAt`, `endedAt`, relaxed foreign key

**Files:**
- Modify: `src/server/db/schema/maze.ts` (add `deletedAt: timestamp("deleted_at")`, nullable)
- Modify: `src/server/db/schema/match.ts` (add `endedAt: timestamp("ended_at")`, nullable; `match_player.mazeId` → `onDelete: "set null"`)
- Create: `drizzle/0007_*.sql` via `pnpm db:generate`, then hand-append the backfill
- Modify: the three terminal writers — `src/server/api/routers/run.ts` (move completion ~L233, give-up ~L316), `src/server/match/sweep.ts` (~L91) — to set `endedAt: now` beside `lastActivityAt: now`
- Test: `tests/integration/match-schema.test.ts`, `tests/integration/sweep.test.ts`, `tests/integration/run-result.test.ts`

**Interfaces:**
- Produces: `maze.deletedAt: Date | null`, `match.endedAt: Date | null` (non-null exactly when status is terminal), `matchPlayer.mazeId` nullable after purge.

- [ ] **Step 1: Failing tests.**
  - `it("records when a match ended, on give-up")`: `runningMatch()`, `guest.run.giveUp`, read the row; `expect(row.endedAt).toBeInstanceOf(Date)` and `toEqual(row.lastActivityAt)`.
  - Same for a completed run (walk `GATED_MAZE_ROUTE`) and for a sweep-abandoned match (`sweepAll` past its deadline).
  - `it("an open match has no end time")`: freshly created match, `endedAt` null.
- [ ] **Step 2:** `pnpm test:integration tests/integration/run-result.test.ts` — FAIL (`endedAt` undefined).
- [ ] **Step 3:** Schema changes, then `pnpm db:generate`. Append to the generated SQL:
  ```sql
  UPDATE "match" SET "ended_at" = "last_activity_at"
  WHERE "status" IN ('complete', 'abandoned') AND "ended_at" IS NULL;
  ```
  Then `pnpm db:migrate` against your dev branch. Add `endedAt: now` to the three writers. Document `endedAt` in the `match` table's JSDoc: it is stored, despite §6's stance, because a sweep-closed match has no player timestamp to derive it from.
- [ ] **Step 4:** Integration tests pass; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat: record when a match ended, and let a match outlive its labyrinth`

### Task 2: Pure rules — labyrinth state, cap, retention

**Files:**
- Create: `src/maze/library.ts` (export from `src/maze/index.ts`)
- Create: `src/match/retention.ts` (export from `src/match/index.ts`)
- Test: `tests/unit/maze/library.test.ts`, `tests/unit/match/retention.test.ts`

**Interfaces:**
- Produces:
  - `MAZE_LIMIT = 10`
  - `type MazeState = "draft" | "ready" | "used"`
  - `mazeState(m: { status: "draft" | "submitted"; contentHash: string | null }): MazeState`
  - `REPLAY_RETENTION_DAYS = 30`
  - `replayExpired(endedAt: Date | null, now: Date): boolean` — false while `endedAt` is null
  - `drawingDeleted(m: { deletedAt: Date | null } | null, endedAt: Date | null, now: Date): boolean` — true when `m` is null (purged), or `m.deletedAt` is set and `replayExpired(endedAt, now)`

- [ ] **Step 1: Failing tests.**
  - `mazeState`: `{draft, null}` → `"draft"`; `{draft, "h"}` → `"ready"`; `{submitted, "h"}` → `"used"`.
  - `replayExpired`: null → false; ended 30 d − 1 ms ago → false; exactly 30 d ago → true; 31 d → true.
  - `drawingDeleted`: null maze → true; not deleted, 60 d old → false; deleted, 29 d old → false; deleted, 31 d old → true.
- [ ] **Step 2:** `pnpm test` — FAIL (module missing).
- [ ] **Step 3:** Implement. No imports outside `src/maze` / `src/match` (invariant 2).
- [ ] **Step 4:** `pnpm test` passes; `pnpm lint`.
- [ ] **Step 5: Commit** `feat: labyrinth state, the 10-labyrinth cap and the 30-day replay window as pure rules`

### Task 3: The cap, on the server

**Files:**
- Modify: `src/server/api/routers/maze.ts` (`createDraft`, `draftForMatch`, `list`)
- Modify: `messages/en.json`, `messages/sk.json` (`errors.mazeLimitReached`)
- Test: `tests/integration/maze-router.test.ts`

**Interfaces:**
- Consumes: `MAZE_LIMIT`, `mazeState` (Task 2); `maze.deletedAt` (Task 1).
- Produces: `maze.list` rows gain `state: MazeState`; rows with `deletedAt` set are excluded. Refusal: `TRPCError({ code: "FORBIDDEN", message: "errors.mazeLimitReached" })` with the limit available to the client as `{ limit: MAZE_LIMIT }` (follow how existing keyed errors carry params — see `resolveErrorKey`).
- Copy: en `"You can keep at most {limit} labyrinths. Delete one to make room."`; sk `"Môžete mať najviac {limit} bludísk. Ak chcete vytvoriť nové, jedno vymažte."`

- [ ] **Step 1: Failing tests.**
  - `it("refuses an 11th labyrinth")`: create 10 via `createDraft`, the 11th → `rejection(...)` equals `{ code: "FORBIDDEN", message: "errors.mazeLimitReached" }`.
  - `it("counts used labyrinths toward the cap")`: seed 9 drafts + 1 submitted (via `runningMatch`-style submit), next create refused.
  - `it("lets draftForMatch reuse an empty draft at the cap")`: at 10 with one empty draft at the match's settings → returns its id.
  - `it("lets draftForMatch refuse at the cap when nothing is reusable")`.
  - `it("lets only one of two concurrent creations take the last slot")`: at 9, `Promise.allSettled([create, create])` → exactly one fulfilled; count is 10.
  - `it("lists each labyrinth's state")`: draft, ready, used rows carry `state` `"draft" | "ready" | "used"`.
- [ ] **Step 2:** `pnpm test:integration tests/integration/maze-router.test.ts` — FAIL.
- [ ] **Step 3:** In both procedures, wrap count + insert in `ctx.db.transaction`; first `SELECT … FOR UPDATE` the caller's `user` row to serialise their creations, then count `maze` rows with `authorId = me AND deletedAt IS NULL`; refuse at `>= MAZE_LIMIT`. In `draftForMatch` the reuse lookup stays before the count. Add `contentHash` to `list`'s select, map to `state`, drop it from the payload.
- [ ] **Step 4:** Tests pass; `pnpm test` (catalogue parity).
- [ ] **Step 5: Commit** `feat: cap each player at 10 labyrinths`

### Task 4: Deleting a used labyrinth

**Files:**
- Modify: `src/server/api/routers/maze.ts` (`ownedBy`, `remove`)
- Modify: `src/server/api/routers/match.ts` (`eligibleMazes`, `submitMaze` maze lookup)
- Test: `tests/integration/maze-router.test.ts`, `tests/integration/match-router.test.ts`

**Interfaces:**
- Consumes: `maze.deletedAt` (Task 1).
- Produces: `maze.remove` on a submitted maze sets `deletedAt = now` and returns `{ id }`; on a draft it hard-deletes as now. `ownedBy(id, userId)` now also requires `deletedAt IS NULL`, so `get`, `saveDraft`, `discardIfEmpty` and `remove` treat a deleted maze as `errors.notYourMaze`.

- [ ] **Step 1: Failing tests.**
  - `it("deletes a used labyrinth from the author's view")`: after `remove`, `list` lacks it, `get` → `errors.notYourMaze`, a second `remove` → `errors.notYourMaze`.
  - `it("frees a slot when a used labyrinth is deleted")`: at 10 incl. one used, delete the used one, `createDraft` succeeds.
  - `it("keeps the row while its match still needs it")`: the deleted maze's row still exists in `maze` with `deletedAt` set.
  - `it("lets the match go on after its labyrinth is deleted")` (Review Focus 2): in `runningMatch()`, host deletes their maze; `guest.run.move` still succeeds.
  - `it("neither offers nor accepts a deleted labyrinth")`: `eligibleMazes` omits it; `submitMaze` with its id → `errors.notYourMaze`.
- [ ] **Step 2:** Run — FAIL (`remove` currently refuses with `errors.mazeIsSubmitted`).
- [ ] **Step 3:** Implement. In `submitMaze`, add `isNull(maze.deletedAt)` to the locked transaction's maze query. `eligibleMazes` adds the same condition. Do not change any `run.*` maze read.
- [ ] **Step 4:** Tests pass. Update any existing test that asserted `remove` refuses a submitted maze.
- [ ] **Step 5: Commit** `feat: a used labyrinth can be deleted; matches that used it keep it`

### Task 5: Replay expiry and per-drawing results

**Files:**
- Modify: `src/server/api/routers/run.ts` (`result`, `replay`)
- Modify: `src/server/api/routers/AGENTS.md` (sanctioned readers: note the 30-day rule and deleted drawings)
- Modify: catalogues (`errors.replayExpired`)
- Test: `tests/integration/run-result.test.ts`, `tests/integration/run-replay.test.ts`

**Interfaces:**
- Consumes: `replayExpired`, `drawingDeleted` (Task 2); `endedAt`, `deletedAt`.
- Produces:
  - `run.replay` refuses `errors.replayExpired` when `replayExpired(row.endedAt, now)`, checked before reading `maze`.
  - `run.result` returns `replayable: boolean` (`mazes !== null && !replayExpired`) and `mazes: { theirs: Drawing | null; yours: Drawing | null } | null`, where `Drawing = { maze: Maze; path: Point[] }` and a null drawing means "deleted". Outer `null` keeps today's meaning (not both submitted).
- Copy: `errors.replayExpired` en `"Replays are kept for {days} days after a match ends."`, sk `"Záznamy sa uchovávajú {days} dní po skončení zápasu."`

- [ ] **Step 1: Failing tests** (age a match by `db.update(match).set({ endedAt: new Date(Date.now() - 31 * DAY) })`).
  - replay: within 30 d → returns; past 30 d → `{ code: "CONFLICT", message: "errors.replayExpired" }` (via the existing `refuse`) for both `whose` values.
  - result: past 30 d, nothing deleted → `replayable: false`, both drawings present.
  - result: past 30 d, host's maze soft-deleted → from host's side `yours: null`, `theirs` present; from guest's side the reverse.
  - result: within 30 d, host's maze soft-deleted → both drawings present, `replayable: true`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. In `result`, select `deletedAt` with each maze; look rows up by id tolerating a missing row or null `mazeId`; never `!`-assert `mazeId`.
- [ ] **Step 4:** Tests pass, existing result/replay tests still pass.
- [ ] **Step 5: Commit** `feat: replays expire 30 days after a match ends; deleted labyrinths drop out of old results`

### Task 6: Purging deleted labyrinths

**Files:**
- Create: `src/server/maze/purge.ts`
- Modify: `src/app/api/cron/sweep/route.ts` (call after the sweep; return both results)
- Test: `tests/integration/purge.test.ts`, `tests/integration/cron-sweep.test.ts`

**Interfaces:**
- Consumes: `REPLAY_RETENTION_DAYS`; `deletedAt`, `endedAt`, FK `SET NULL` (Task 1).
- Produces: `purgeDeletedMazes(db: typeof Database, now: Date): Promise<{ purged: number; capped: boolean }>` with `PURGE_BATCH_LIMIT = 100`. Cron response `{ ...sweepResult, purge: { purged, capped } }`.

- [ ] **Step 1: Failing tests.**
  - purges a deleted maze whose only match ended 31 d ago; `match_player.mazeId` for it is then null.
  - keeps a deleted maze whose match ended 29 d ago.
  - keeps a deleted maze referenced by an open match (any status not terminal).
  - (Review Focus 3) keeps a deleted maze used in one match ended 40 d ago and one ended 5 d ago.
  - never touches a maze with `deletedAt` null, however old.
  - (Review Focus 4) after purge, `run.result` for that match returns scores, the purged side's drawing null, the other present.
  - cron route test: response includes `purge`.
- [ ] **Step 2:** `pnpm test:integration tests/integration/purge.test.ts` — FAIL.
- [ ] **Step 3:** One `DELETE … WHERE id IN (SELECT … LIMIT n)`: `deleted_at IS NOT NULL AND NOT EXISTS (match_player mp JOIN match m … WHERE mp.maze_id = maze.id AND (m.ended_at IS NULL OR m.ended_at > now - 30 days))`. A deleted maze never submitted anywhere has no references and qualifies at once.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5: Commit** `feat: the nightly sweep removes deleted labyrinths once no match can show them`

### Task 7: Result screen and watch page

**Files:**
- Modify: `src/components/run/match-result.tsx`
- Modify: `src/server/api/routers/test-support.ts` (add `ageMatch`)
- Modify: catalogues (`mazeDeleted` in the namespace `match-result.tsx` uses: en `"This labyrinth was deleted."`, sk `"Toto bludisko bolo vymazané."`)
- Test: `e2e/watch.spec.ts` (already covers the result screen's replay links)

**Interfaces:**
- Consumes: `run.result`'s `replayable` and nullable drawings (Task 5).
- Produces: `testSupport.ageMatch({ matchId, days })` — sets `endedAt` back by `days`, guarded by `assertEnabled()`, caller must be a participant.

- [ ] **Step 1: Failing e2e test** `"an old match keeps its result and drops the replay"`: finish a match, host deletes their labyrinth on `/labyrinths`, `ageMatch(31)`, reload the result: scores visible; `[data-replay-link]` count 0; the host's own-maze slot shows "This labyrinth was deleted."; the opponent's maze is drawn. Visiting `/matches/<id>/watch?run=mine` shows `[data-watch-error]` with the expired text.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Render each drawing or the note independently; replay links only when `replayable`. The watch page already renders refusal keys; confirm it needs no change.
- [ ] **Step 4:** e2e passes on desktop and mobile.
- [ ] **Step 5: Commit** `feat: the result screen marks deleted labyrinths and hides expired replays`

### Task 8: Shared `MazeTile`

**Files:**
- Create: `src/components/maze-tile.tsx`
- Modify: `src/components/editor/maze-list.tsx`, `src/components/match/maze-picker.tsx`
- Test: existing `e2e/lobby.spec.ts`, `e2e/editor.spec.ts` (covers `[data-maze-item]`)

**Interfaces:**
- Produces: `MazeTile` rendering frame (`rounded-lg border-2 p-2`, `w-40 sm:w-44`), name on top, preview (or the `bg-cell-void` placeholder) below. It takes the name, the preview maze (or null), a `selected?: boolean` for the accent border, and slots/children for caller extras. Rendering as `<li>` vs `<button role="radio">` is the builder's call; the picker keeps `data-maze-option`, `role="radio"`, roving tab stop and deselect-on-click; the list keeps `data-maze-item`, its links and Delete.

- [ ] **Step 1:** Update the lobby e2e tile-width assertion to also hold on `/labyrinths` (`tile.width < thumb.width * 1.5`) and assert both tiles have equal width at the same viewport — FAIL today (`w-32` vs `w-40`).
- [ ] **Step 2:** Implement and switch both callers.
- [ ] **Step 3:** `pnpm e2e e2e/lobby.spec.ts` and `e2e/editor.spec.ts` pass.
- [ ] **Step 4: Commit** `refactor: one tile for the labyrinth list and the match picker`

### Task 9: `/labyrinths` filters, sort, state marker and limit UI

**Files:**
- Create: `src/components/editor/maze-filters.tsx` (controls) and a pure `filterAndSort` helper beside it or in `src/components/editor/maze-library.ts`
- Modify: `src/components/editor/maze-list.tsx`, `src/components/editor/new-maze-form.tsx`, `src/components/match/maze-picker.tsx` (`DrawNew` disabled at the cap), `src/app/[locale]/(app)/labyrinths/page.tsx`
- Modify: catalogues (labyrinths namespace: `filterAll`, `filterDrafts`, `filterReady`, `filterUsed`, `filterSquares`, `filterGates`, `filterAny`, `sortLabel`, `sortEdited`, `sortName`, `sortSize`, `noMatches`, `count` (`"{count} / {limit}"`), `atLimit`, `usedBadge`, `confirmDeleteUsed`; lobby namespace: `atLimit`)
- Test: `tests/unit/editor/maze-library.test.ts`, new `e2e/labyrinths.spec.ts`

**Interfaces:**
- Consumes: `maze.list` rows with `state` (Task 3); `MAZE_LIMIT`; `MazeTile` (Task 8).
- Produces: `filterAndSort(items, { state: MazeState | "all"; squares: number | "any"; gates: number | "any"; sort: "edited" | "name" | "size" })`.

- [ ] **Step 1: Failing unit tests** for `filterAndSort`: each state filter; squares and gates combined; `edited` newest first; `name` locale-aware A–Z (`localeCompare`); `size` by squares then gates ascending.
- [ ] **Step 2: Failing e2e tests:**
  - filter by Used shows only the used tile, which carries the used marker and no Delete-is-blocked error; Drafts / Ready likewise.
  - the squares select lists only sizes the player owns.
  - (Review Focus 5) choose squares = 64, delete the only 64 labyrinth → the filter resets to Any and the remaining tiles show.
  - an all-filtered-out state shows `noMatches`, not `empty`.
  - at 10: count reads "10 / 10", "New labyrinth" disabled with `atLimit` text; in a match lobby "Draw a new one" disabled with the lobby `atLimit` text.
  - deleting a used labyrinth: confirm copy is `confirmDeleteUsed`, tile disappears, count drops.
- [ ] **Step 3:** Implement. Size options derive from the current list; a selected size missing from the list resets to `"any"`. Filter state in the URL query or component state — builder's call. Copy for new keys: write natural en and sk; `confirmDeleteUsed` en `"Delete {name}? Past matches keep their results."`.
- [ ] **Step 4:** Unit and e2e pass; `pnpm typecheck && pnpm lint && pnpm format`.
- [ ] **Step 5: Commit** `feat: filter, sort and count labyrinths on /labyrinths`

### Task 10: Spec amendments and final verification

- [ ] **Step 1:** Amend `docs/superpowers/specs/2026-09-22-labyrinth-design.md` §6 (deletable used labyrinths, `endedAt`, FK), §10.3.1 and §10.4 (30-day replay, deleted drawings) and add a §17 decisions-log row, pointing at the new spec.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration && pnpm e2e` — all pass.
- [ ] **Step 3: Commit** `docs: fold the labyrinth library rules into the main design`
