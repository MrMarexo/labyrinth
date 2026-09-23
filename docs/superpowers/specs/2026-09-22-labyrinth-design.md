# Labyrinth — Design Spec

Date: 2026-09-22
Status: Approved for planning

## 1. Overview

A web app where two players each draw a secret labyrinth, then race through
the other's. The drawn maze is stored as data, not as an image, so the app can
re-render it, validate it, and adjudicate movement through it.

A match runs like this:

1. One player creates a match, choosing the cell budget and the gate count.
   They get a short join code and a link.
2. The opponent signs in and joins. Both settings are now frozen for the match.
3. Both players draw a labyrinth, independently and simultaneously.
4. When both mazes are submitted, both runs unlock. Each player solves the
   **opponent's** maze.
5. A run is continuous — you move until you reach the treasure. You never wait
   for the other player.
6. Each blocked move costs one penalty. Fewest penalties wins.
7. The result is withheld until both players finish, then revealed to both.

The author of a maze may watch their opponent solving it live, and may replay
any completed run afterwards.

## 2. Game rules

### 2.1 Terms

- **Cell** — one square of the labyrinth.
- **Segment** — a wall or a gate, sitting on the edge *between* two cells.
- **Void** — a square that is not part of the labyrinth.
- **Penalty** — the score. Incremented by one on every blocked move. This is
  what the original description calls a "turn"; there is no alternating turn
  order.

### 2.2 Movement

The runner occupies one cell and moves N/E/S/W one cell at a time.

| Attempted move | Outcome | Penalty | Revealed to runner |
|---|---|---|---|
| Into an open edge | Moves | 0 | Destination cell and its contents; edge recorded open |
| Into a wall | Stays | +1 | That segment, as blocked |
| Into the outer boundary or a void cell | Stays | +1 | That edge, as blocked — **rendered identically to a wall** |
| Into a gate without its key | Stays | +1 | That segment, as a gate, including its gate id/colour |
| Into a gate holding its key | Moves | 0 | Gate marked open; destination cell and contents |
| Onto a cell holding a key | Moves, key acquired | 0 | Destination cell, key id |
| Onto the treasure cell | Moves, run ends | 0 | Treasure |

A runner cannot distinguish a void square from a walled square. That is
deliberate: it means a sealed-off pocket costs the author budget and buys them
nothing, so the game self-corrects rather than needing a rule.

### 2.3 The labyrinth is enclosed

A runner can never leave the labyrinth. Every edge of the painted shape that
faces outward — the outer boundary and the border of any void square — is
solid, and walking into it is an ordinary blocked move.

This is guaranteed by construction rather than checked: outward-facing edges are
implicit and are never stored as data (§3.1), so there is nothing to omit and
no way to draw a leaky maze. It is written down here because it is a rule of
the game, not an implementation detail.

### 2.4 Fog of war

The runner is told nothing at the start except that they are on the start cell.
They do not know the grid dimensions, the shape of the labyrinth, where the
treasure is, or where any key or gate is. Everything is learned by walking into
it. This is why the server must be the sole authority (§7).

### 2.5 Keys and gates

Gates and keys are matched pairs, identified by id and colour-coded in the UI.
Gate 1 is opened only by key 1. A gate, once opened, stays open for the rest of
that run. Each gate id appears on exactly one segment and has exactly one key.

### 2.6 Scoring

Fewest penalties wins. Tiebreakers, in order: fewer total moves, then shorter
elapsed run time. Both players' mazes share the same cell budget and gate count,
which is what makes the raw comparison defensible — beyond that, asymmetry is
intentional. You chose how cruel to make your maze.

## 3. Maze format

Stored as `jsonb`. Versioned. Validated by a `zod` schema on the way in and out.

```jsonc
{
  "version": 1,
  "cells": [ { "x": 0, "y": 0 }, { "x": 1, "y": 0 } ],
  "start":    { "x": 0, "y": 0 },
  "treasure": { "x": 7, "y": 4 },
  "segments": [
    { "o": "H", "x": 3, "y": 4, "kind": "wall" },
    { "o": "V", "x": 5, "y": 2, "kind": "gate", "gate": 1 }
  ],
  "keys": [ { "gate": 1, "x": 2, "y": 6 } ]
}
```

### 3.1 Edge addressing

Walls and gates live between squares, so the unit of storage is the edge, not
the cell. Storing four wall flags per cell would record every interior edge
twice and allow the two copies to disagree.

With `y` increasing downward:

- `{ "o": "H", "x": x, "y": y }` is the edge between `(x, y)` and `(x, y+1)`.
- `{ "o": "V", "x": x, "y": y }` is the edge between `(x, y)` and `(x+1, y)`.

Every edge therefore has exactly one legal spelling, and a duplicate is a
validation error rather than a silent inconsistency.

The boundary between a cell and a void square is implicitly solid and is never
stored.

### 3.2 Normalization and hashing

Before storage, the shape is translated so that `min(x) == 0` and `min(y) == 0`,
and `cells`, `segments` and `keys` are sorted canonically. The content hash is
computed over that normalized form, so the same labyrinth drawn in a different
place on the canvas hashes identically. The hash lets a player recognise and
reuse a maze they have already drawn.

### 3.3 Limits

- `cellCount` presets: 36, 64, 100, 144. Set per match.
- `gateCount`: 0–8. Set per match. The cap keeps the solver's state space small
  (§4.2).
- Bounding box of the drawn shape: at most 16 × 16.

The 16 × 16 cap is set by the desktop board, not by storage. Wall edges need a
~14 px hit strip to be comfortably clickable, which wants cells around 44 px;
16 cells is then ~700 px of board, which sits beside the side panel on a
1280 px laptop without cramping. At 20 cells the squares drop to ~35 px and the
edges get fiddly.

The cap is also what prevents degenerate shapes. There is deliberately **no
minimum** — a corridor may be one square wide anywhere it likes — but a maze
that is one square tall and sixty-four wide cannot exist, because 64 exceeds
the width cap. The budget and the cap together do that work, so no separate
rule is needed.

## 4. Validation

Two passes, both in `src/maze/`, both run in the browser for live editor
feedback and again on the server on submit. Only the server's verdict counts.

### 4.1 Structural (zod + checks)

- `version` is known.
- `cells.length === match.cellCount`; no duplicate cells.
- The cell set is orthogonally connected — one flood fill, ignoring walls. No
  floating islands.
- `start` and `treasure` are both in `cells` and are different cells.
- The start cell holds no key and no treasure.
- Each cell holds at most one of { key, treasure }.
- The shape's bounding box is at most 16 × 16 (§3.3).
- Every segment's two adjacent cells are both in `cells`.
- No two segments share an `(o, x, y)`.
- Gate ids are exactly `1..gateCount`, each on exactly one segment.
- Exactly one key per gate id; every key is on a cell in `cells`.

### 4.2 Solvability

A search over `(cell, keysHeld)` rather than over cells, where `keysHeld` is a
bitmask. With gates capped at 8 the state space is at most
`cells × 256` — trivial. Start at `(start, 0)` and require the treasure to be
reachable.

This single check subsumes the ordering rule that would otherwise need writing
by hand: a key locked behind its own gate never appears in any reachable state,
so the maze simply fails. No separate pass, no special cases.

**Sealed-off pockets inside the shape are permitted.** Only the treasure must be
reachable, not every cell. See §2.2 for why this needs no further rule.

**Decorative gates are permitted.** A gate with nothing of value behind it,
placed purely to waste the runner's time, is legal. So is a gate whose key sits
somewhere the runner can never get to, making it permanently locked. Neither
blocks the treasure, so neither fails validation. Misdirection is a legitimate
design tool and the validator does not police it.

### 4.3 Derived metrics

The search also returns `optimalMoves`, the shortest route from start to
treasure, which is stored on the maze row because the solver computes it for
free and the future single-player leaderboard will want it.

**It is never displayed.** There is no difficulty readout while drawing, no
"your maze is too easy" hint, and no guidance about gate placement. Authors
draw what they want. The only judgement the app makes about a maze is whether
the treasure can be reached.

## 5. Architecture

### 5.1 Stack

`create-t3-app` baseline — Next.js App Router, TypeScript strict, tRPC,
Tailwind v4 — with two deliberate choices:

- **Drizzle**, not Prisma. Neon plus serverless functions is exactly the case
  where Prisma's engine and connection handling cost cold-start time, and
  Drizzle's migrations are plain reviewable SQL.

  Use the **WebSocket pool** from `@neondatabase/serverless` — that is
  `drizzle-orm/neon-serverless` with `Pool`, not `drizzle-orm/neon-http`. The
  HTTP driver cannot open an interactive transaction, and §7 requires the move
  row and the updated `runState` to be written as one atomic unit. Getting this
  wrong does not fail loudly: it fails as a rare double-counted or lost penalty
  under a retry, which is the score. The WebSocket pool costs a little more on a
  cold connection and that is the right trade.
- **Better Auth**, not NextAuth. A deviation from stock T3, taken because the
  requirement is email and password. Auth.js's Credentials provider forces JWT
  sessions — so no server-side revocation — and deliberately leaves hashing,
  verification and reset to the application. Better Auth ships all of it with a
  first-class Drizzle adapter and database sessions. Revisit if OAuth providers
  become a requirement.

Hosting: Vercel. Database: Neon Postgres. Realtime: Pusher Channels.
Environment variables validated at boot with `@t3-oss/env-nextjs`.

### 5.2 Module boundaries

One Next.js app, not a monorepo. The constraint that matters is narrower:

**`src/maze/` imports nothing from Next, tRPC, Drizzle or React.** It holds the
format schema, the validator, the solver and the move reducer as pure functions
over plain data.

Three consumers run the same reducer — the server as authority, the live
spectator view, and the replay view — which is the main reason to keep it pure.
A future mobile client needs all four modules, and extracting a directory that
already imports nothing is a move rather than a rewrite. The workspace gets
created when a second consumer actually exists, not before.

## 6. Data model

```
user            id, email citext unique, passwordHash, displayName, locale, createdAt
                (+ Better Auth session / verification tables)

maze            id, authorId, name, cellCount, gateCount,
                data jsonb, contentHash, optimalMoves,
                status (draft | submitted), createdAt, updatedAt

match           id, code unique, cellCount, gateCount,
                status, createdById, createdAt,
                lastActivityAt, deadlineAt,
                winnerId nullable, endReason nullable

match_player    matchId, userId, mazeId,          -- the maze THEY drew
                runStatus (not_started | running | finished),
                penalties, moveCount, runState jsonb,
                submittedAt, startedAt, lastMoveAt, finishedAt,
                forfeitedAt nullable
                primary key (matchId, userId)

move            id, matchId, runnerId, seq, dir, outcome,
                revealed jsonb, createdAt
                unique (matchId, runnerId, seq)
```

The maze a player *solves* is the opponent's `match_player.mazeId`, never their
own. That join is the only place the mapping exists.

A maze becomes **immutable once submitted** — it is referenced by finished
matches and by their replays, so editing it would rewrite history.

A submitted maze may be **reused as-is** in a later match whose `cellCount` and
`gateCount` match, which is what makes the "my labyrinths" library worth having.
Reuse against an opponent who has already solved that maze is rejected.

There is **no edit and no duplicate-to-edit.** Picking an old maze for a new
match means playing it exactly as drawn. Wanting something different means
drawing a new one from scratch. Drafts, which have never been submitted, remain
freely editable.

`deadlineAt` is recomputed on every phase transition and every move, following
§9.1 — it is a single column rather than six rules scattered across the code,
so the sweep is one indexed query. `endReason` is `finished | forfeit |
abandoned`, and `winnerId` is null for everything except `finished` and
`forfeit`, which is how "you cannot win without finding the treasure" is
enforced at the schema level rather than by convention.

`runState` holds position, keys held as a bitmask, opened gates, and the
discovered set. It is a denormalized cache so a 300-move run does not replay
itself on every request. **The move log is the source of truth** and is what
replay reads.

## 7. Move protocol and anti-cheat

`match.move({ matchId, seq, dir })`:

1. Load `runState` and the opponent's maze.
2. Apply the pure reducer.
3. Write the `move` row and the updated `runState` in one transaction.
4. Publish the delta to the realtime channel (§8).
5. Return **only the delta**: outcome, new position if it moved, the single
   segment or cell revealed, any key acquired, the running penalty count.

`dir` is one of `N | E | S | W`.

`outcome` is one of:

`moved | moved_found_key | moved_found_treasure | moved_through_gate |
blocked_wall | blocked_gate | blocked_boundary`

`blocked_boundary` covers both the outer edge and a void square. It is a
distinct value **server-side only**, for analytics and replay fidelity. What
the runner receives for `blocked_boundary` and `blocked_wall` must be byte-for-
byte identical (§2.2), and there is a property test asserting exactly that
(§12).

### 7.1 Anti-cheat is structural

No tRPC procedure reachable by a runner may select `maze.data`. Author-facing
reads and runner-facing reads are separate procedures with separate return
types, so leaking the maze requires a deliberate edit rather than an oversight.
The client-side validator is a convenience duplicate for editor feedback and its
verdict is never trusted.

### 7.2 Idempotency

`seq` is client-generated and unique per `(matchId, runnerId)`. A retried request
on a flaky connection cannot produce a phantom penalty. Since penalties *are*
the score, this matters more here than it normally would.

### 7.3 No optimistic movement

The client genuinely does not know whether a wall is there — that is the game.
Guessing and rolling back would flicker the map and sometimes draw a wall that
does not exist. Instead: a brief pending state, and held-key input queued as
sequential `seq`-numbered moves so holding an arrow key feels continuous at
~150 ms round trips.

## 8. Realtime, spectating and replay

On commit, the server publishes the move delta to a Pusher **presence** channel
scoped to `{ matchId, runnerId }`. The channel auth endpoint admits only the
maze's author.

The runner subscribes to the same channel solely to read its member list — that
is the "someone is watching you" indicator, and it costs nothing extra because
presence is the transport's job.

**Replay is the same viewer component**, fed from the stored move log instead of
the socket, with a scrubber, play/pause and speed. Because runs are async the
author is usually offline while their maze is being solved, so replay is the
feature that will actually get used; live spectating is the same component with
a different source. Sharing the component is what stops the two drifting apart
visually.

**Spectating leaks nothing.** A watching author sees their own maze, which they
already know, plus the runner's position within it. They learn nothing about
the maze *they* still have to solve, because that is the other player's
creation. Watching is therefore unrestricted and needs no gating on the
watcher's own run state.

### 8.1 Publisher abstraction

The server publishes through a `RealtimePublisher` interface with two
implementations: Pusher in production, an in-process implementation in
development and test. Pusher in CI is flaky and rate-limited; the e2e suite runs
against the local implementation, with a single nightly smoke test against the
real service. This is the operational cost of choosing a realtime vendor, paid
deliberately.

## 9. Match lifecycle

```
awaiting_opponent → drawing → running → complete
                          ↘ abandoned (on expiry)
```

- `awaiting_opponent` — created, code issued, nobody has joined.
- `drawing` — both players present, each drawing. Settings frozen.
- `running` — both mazes submitted. Both runs unlock at once and proceed
  independently.
- `complete` — both `finishedAt` set, or one player finished and the other ran
  out of time. Only now is the result computed and revealed, so the second
  finisher cannot play to a known target.
- `abandoned` — closed with **no winner**. See §9.1.

### 9.1 Deadlines

| Situation | Deadline | Outcome |
|---|---|---|
| Nobody has joined | 24h from creation | `abandoned`, no winner |
| Both joined, neither has submitted a maze | 48h with no activity from either | `abandoned`, no winner |
| One submitted a maze, the other has not | 24h from that submission | `abandoned`, no winner; recorded against the player who did not draw |
| Both submitted, neither has made a single move | 24h from the runs unlocking | `abandoned`, no winner |
| Both have moved, neither has finished | 48h since the last move by either | `abandoned`, no winner |
| One found the treasure, the other has not | 24h from that finish | `complete`; the non-finisher loses, the finisher wins |

Two principles hold this together, and they resolve every case above.

**You cannot win without finding the treasure.** A player who misses a deadline
forfeits, but forfeiting does not hand the opponent a win unless that opponent
actually reached the treasure. That is why every row but the last closes with no
winner, including the case where you drew your maze and your opponent never drew
theirs. Missing a drawing deadline is recorded against the player who missed it —
which is what a future reliability or reputation stat would read — but it does
not put an unearned win on the other player's record.

**Nothing expires while both players are still engaged.** Every deadline is
anchored to the last thing that actually happened, so an active match is never
timed out from under anyone.

A scheduled sweep evaluates these, so a stale match closes on its own rather
than waiting for someone to open it.

## 10. Client

### 10.1 Rendering

**SVG, not canvas.** At a few hundred cells canvas buys nothing, while SVG stays
crisp under zoom, themes from CSS custom properties so dark mode is free, and
makes every edge and cell an addressable DOM node — the difference between a
Playwright test that clicks `[data-edge="H:3,4"]` and one that computes pixel
offsets and breaks on every layout change.

### 10.2 Editor

Two modes over one board.

**Shape mode** paints and erases cells against the budget, with a live
`48 / 64 squares` counter and drag-to-paint.

**Detail mode** exposes the palette — wall, gate, key, start, treasure. Walls
and gates snap to edges; keys, start and treasure snap to cells. Dragging along
a line of edges lays multiple walls in one gesture. Clicking an existing item
with the active tool removes it, and an explicit eraser handles the ambiguous
cases.

Required, not optional:

- **Undo / redo.** Nobody places sixty walls without a mistake.
- **Draft autosave** to the maze row. Losing a half-drawn labyrinth to a page
  refresh is the kind of thing that ends someone's interest in an app.

The side panel runs the validator continuously and reports only facts, never
judgement: squares used against the budget, gates and keys placed, and whether
the maze is currently valid. Submit is disabled while invalid and names the
specific failure. There is deliberately no difficulty score and no advice about
gate placement (§4.3).

**Known risk:** edge hit targets. A wall is a one-pixel line needing a ~14 px
invisible hit strip, and the hit test must resolve "nearest edge" or "containing
cell" depending on the active tool. With pinch-zoom and pan this works on a
phone; it will not be pleasant on a phone. v1 does not close that gap — a native
mobile client is the intended answer, out of scope here.

### 10.3 Run view

The same board component with a different data source: discovered cells and
bumped segments instead of the full maze. Arrow keys and WASD on desktop, an
on-screen d-pad on touch. Penalties take the prominent position since they are
the score; moves and held keys (colour-matched to their gates) are secondary. A
blocked move shakes the board and draws the segment that stopped you.

### 10.4 Spectator and replay view

**Two boards side by side.** On the left, what the runner can see — their
discovered cells and the segments they have bumped. On the right, the author's
own maze in full, as drawn. The runner's position is marked on both, so you can
watch them edge along a corridor and see the wall they are about to hit.

The second board exists because authors do not remember their own walls. Drawing
sixty segments and then recognising the maze from a partial fog-of-war view a day
later is not realistic, and without the reference board spectating is mostly
confusing.

On narrow screens the two boards stack, with the runner's view first.

Replay is the same two-board layout with a scrubber, play/pause and speed. The
runner sees a small "2 watching" badge fed from the presence member list.

### 10.5 Theming

Tailwind v4 CSS custom properties with `data-theme` on `html`. Tri-state
system / light / dark, persisted, with the standard inline script to prevent a
flash of the wrong theme. Maze colours are tokens, so the board themes itself.

### 10.6 Internationalisation

`next-intl` on a `/[locale]/` route segment. Locales: `en` (source and
fallback) and `sk`. JSON message namespaces with type-safe keys.

**Validation failures travel as message keys with parameters, never as English
strings.** The tRPC error formatter maps zod issues into keys and the client
translates them. This is the part that is usually botched, and getting it wrong
leaves half the error surface silently untranslated.

### 10.7 Responsiveness

Desktop: board plus side panel. Mobile: board with a bottom sheet for the
palette. The board scales to the viewport with zoom and pan. See the known risk
in §10.2.

## 11. Error handling

A small closed set of typed application errors, surfaced through the tRPC error
formatter with i18n keys attached so every one is translatable and assertable in
tests by code rather than by copy:

`MazeInvalid`, `MatchExpired`, `MatchFull`, `NotAParticipant`,
`RunNotUnlocked`, `RunAlreadyFinished`, `Forbidden`.

## 12. Testing

Weighted toward the part worth testing.

**Unit and property tests (Vitest + fast-check) on `src/maze/`.** Pure functions
over plain data, so this is the cheapest and highest-value layer. Generate
random connected shapes and assert invariants directly:

- the solver's verdict is stable under translation and rotation of the shape
- the reducer never returns information about a cell the runner has not touched
- penalties are monotonically non-decreasing
- a void-blocked move and a wall-blocked move produce indistinguishable deltas

Those catch the class of bug that kills this game; no amount of e2e clicking
would.

**Integration tests on the tRPC routers against real Postgres**, using a Neon
branch per CI run — instant, disposable, no Docker, and the same engine as
production rather than an approximation.

The deadline rules in §9.1 get their own table-driven suite here, one case per
row, with the clock injected rather than slept through. Six rules with
different anchors and two different durations is exactly the kind of thing that
quietly rots, and the one that matters most — a forfeit never producing a winner
who did not reach the treasure — is asserted directly rather than inferred.

**Playwright**, in two projects (desktop Chromium, mobile Safari viewport):

- sign-up, sign-in, sign-out
- create match, join by code
- both mazes submitted, match reaches `running`
- a run that bumps a wall, collects a key, opens its gate, reaches the treasure
- result stays hidden until the second player finishes, then reveals
- spectating across two browser contexts: presence badge, live position
- replay scrubbing
- theme toggle and locale switch

Two disciplines keep that suite survivable:

- Authentication is seeded via `storageState` through the API, not by driving
  the login form — except in the one test whose subject *is* the login form.
- Mazes are seeded through a test-only procedure behind an env flag. A test that
  clicks sixty wall segments is a test that fails for reasons unrelated to what
  it is checking.

Accessibility: `axe` checks on key pages. The run view is fully keyboard
operable. Full keyboard operation of the editor is a stretch goal, not a v1
commitment.

## 13. AI rules

One canonical `AGENTS.md` at the repository root. `CLAUDE.md` points to it
rather than duplicating it — two files with the same content diverge within a
month.

`AGENTS.md` carries the commands, the architecture map, and the invariants that
are not obvious from reading any single file:

- no procedure reachable by a runner may select `maze.data`
- `src/maze/` imports nothing from Next, tRPC, Drizzle or React
- validation failures travel as i18n keys with params, never as English strings
- the move log is the source of truth; `runState` is a cache
- both players in a match share `cellCount` and `gateCount`, always
- a void-blocked move must be indistinguishable from a wall-blocked move in
  everything the runner receives and everything the client renders

Narrower rules files in `src/maze/` and `src/server/api/routers/` restate the
purity rule and the leak rule where someone editing will actually see them.

## 14. CI and environments

GitHub Actions on every PR: typecheck, ESLint (flat config), Prettier, unit
tests, integration tests against a fresh Neon branch, Playwright against the
local realtime implementation, and a production build.

Migrations apply against the branch database in CI, so a broken migration fails
the pull request rather than the deploy.

Vercel preview deploys per PR, each against its own Neon branch. Neon `main` for
production.

Nightly: the single Pusher smoke test against the real service.

## 15. Phases

| Phase | Deliverable |
|---|---|
| 0 — Foundations | Scaffold, Neon + Drizzle, Better Auth email/password, en/sk i18n, theming, app shell, CI, `AGENTS.md`. Sign up, sign in, switch language and theme. |
| 1 — Maze domain | Format schema, validator, solver, reducer. Headless, fully unit- and property-tested. |
| 2 — Editor | SVG board, shape mode, detail palette, undo/redo, draft autosave, live validation panel, "my labyrinths" list. Draw and save a labyrinth. |
| 3 — Match lifecycle | Create with settings, join by code, submit mazes, state machine, expiry. Two accounts reach `running`. |
| 4 — The run | Move procedure, fog rendering, penalties, keys and gates, finish, withheld reveal. **First phase where the product exists.** |
| 5 — Spectate and replay | Publisher abstraction, Pusher, presence badge, viewer with scrubber. |
| 6 — Polish | Responsive passes, accessibility, empty and error states, history pages, e2e suite completed. |

Phase 1 precedes Phase 2, which means a stretch with nothing visible on screen.
That is uncomfortable and correct: the editor, the run and the replay all trust
the validator, and discovering it is wrong in Phase 4 is far worse than a quiet
week.

## 16. Out of scope

**Single-player mode.** Planned, not built. The schema mostly supports it
already — a run against a maze with no opponent is a `match_player` row without
a counterpart. What it genuinely adds is a curated maze pool and a leaderboard
table. Nothing in this design blocks either.

**Native mobile client.** Planned, not built. This is the intended answer to the
editor's touch ergonomics (§10.2). The purity rule in §5.2 exists so the domain
layer can be shared with it.

**Public lobby and random matchmaking.** v1 is invite-code only. The data model
does not need to change to add a lobby later.

**OAuth sign-in.** Email and password only. See §5.1.

## 17. Decisions log

| Question | Decision |
|---|---|
| Who solves whose maze, and when? | Swapped mazes, asynchronous runs. "Turn" is a penalty counter, not an alternating turn order. |
| What does the runner learn, and when? | Bump-to-learn. Walls are invisible until walked into. |
| How strictly is "one path to the treasure" read? | At least one solution must exist, via the key-aware search. Loops and alternate routes allowed. |
| How do keys map to gates? | Matched pairs, colour-coded, one key per gate. |
| How do players meet? | Invite code and link. Creator sets the settings. |
| How is the winner decided? | Raw penalty count, fewest wins. Asymmetry is part of the game — you drew the maze. |
| Where does the runner start? | The author places a start marker. |
| Is there an in-run drawing tool? | No. The editor is drawing-phase only; the discovered map draws itself. |
| Locales | English and Slovak. |
| Realtime transport | Managed vendor (Pusher), behind a `RealtimePublisher` interface. |
| Replay in v1? | Yes, and it is the primary use — the author is usually offline during the run. |
| Maze footprint | A cell budget, any connected shape, not a rectangle. Void squares cost nothing. |
| Shape size limits | Bounding box at most 16 × 16, sized by what fits comfortably on a desktop board. No minimum — corridors may be one square wide. The cap is what makes a long thin maze impossible. |
| Difficulty feedback to the author | None. No difficulty score, no gate-placement advice, no "too easy" warning. The only judgement made about a maze is whether the treasure is reachable. |
| Decorative gates | Legal, including a gate whose key is unreachable. Misdirection is a design tool, not an error. |
| Enclosure | The labyrinth is always closed; a runner can never leave it. Guaranteed by construction, stated as a rule. |
| Editing a submitted maze | Not possible, and no duplicate-to-edit either. Reuse it exactly as drawn, or draw a new one. Drafts stay editable. |
| Forfeits | Missing a deadline never hands the opponent a win unless that opponent reached the treasure. Every deadline except the last closes the match with no winner. |
| Spectating layout | Two boards side by side — the runner's fogged view and the author's full maze — because authors do not remember their own walls. |
| Connectivity rule | Shape must be orthogonally connected and the treasure must be reachable. Sealed pockets allowed. |
| ORM | Drizzle. |
| Auth library | Better Auth (deviation from stock T3, accepted). |
