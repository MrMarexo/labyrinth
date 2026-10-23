# Labyrinth — Design Spec

Date: 2026-09-22
Status: Approved for planning

## 1. Overview

A web app where two players each draw a secret labyrinth, then race through
the other's. The drawn maze is stored as data, not as an image, so the app can
re-render it, validate it, and adjudicate movement through it.

A match runs like this:

1. One player creates a match, choosing the cell budget and the gate count.
   The match is open (anyone may join) or locked (joining sends a request the
   creator decides on). It appears in the lobby, and a locked match can also be
   sent as a share link ([match lobby spec](2026-10-23-match-lobby-design.md)).
2. The opponent finds it in the lobby, or opens the share link, signs in and
   joins, or is accepted. Both settings are now frozen for the match.
3. Both players draw a labyrinth, independently and simultaneously.
4. When both mazes are submitted, both runs unlock. Each player solves the
   **opponent's** maze.
5. A run is continuous — you move until you reach the treasure. You never wait
   for the other player.
6. Each blocked move is a bump (stored as a penalty). Fewest bumps wins; equal
   bumps is a draw (§2.6).
7. The result is withheld until both players finish, then revealed to both.

The author of a maze may watch their opponent solving it live, and may replay
any completed run afterwards.

## 2. Game rules

### 2.1 Terms

- **Cell** — one square of the labyrinth.
- **Segment** — a wall or a gate, sitting on the edge *between* two cells.
- **Void** — a square that is not part of the labyrinth.
- **Penalty** — the score, shown to players as **bumps**. Incremented by one on
  every blocked move. This is
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

Fewest **bumps** wins. A bump is a move into a wall or a locked gate (stored as
`penalties`); walking is free. There is no tiebreak: **equal bumps is a draw**,
which completes the match with no winner (`endReason: finished`, `winnerId`
null). Both players' mazes share the same cell budget and gate count, which is
what makes the raw comparison defensible — beyond that, asymmetry is
intentional. You chose how cruel to make your maze.

Moves and elapsed run time are recorded and shown, on the finish popup and the
result screen, but never decide anything. Elapsed run time is measured from the
runner's first move to the move that reached the treasure — not from the
unlocking, because runs are asynchronous and a player who starts a day later
has not been slower.

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

Coordinates are absolute within that fixed 16 × 16 frame: the board *is* the
frame, not a viewport onto a larger canvas, so the editor needs no panning,
zooming or scrolling and every stored coordinate is in `0..15`.

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
                access (open | locked), status, createdById, createdAt,
                lastActivityAt, deadlineAt,
                winnerId nullable, endReason nullable

match_player    matchId, userId, mazeId,          -- the maze THEY drew
                joinedAt, submittedAt, forfeitedAt nullable,
                runState jsonb, startedAt, lastMoveAt, finishedAt,
                gaveUpAt nullable
                primary key (matchId, userId)

move            id, matchId, runnerId, seq, dir, outcome,
                delta jsonb, createdAt
                unique (matchId, runnerId, seq)

match_request   matchId, userId, createdAt, declinedAt nullable
                primary key (matchId, userId)
```

`match_request` is a player asking to join a locked match. It lives outside
`match_player` on purpose: a requester row there would pass `participantRows`,
be admitted by `canSubscribe` (§8) and break every "two players" check. A
request is pending while `declinedAt` is null; declining keeps the row so that
player cannot ask again, withdrawing deletes it, and accepting deletes all of
the match's requests. `match.access` is chosen at creation and never changes.
A partial unique index on `match(createdById) WHERE status = 'awaiting_opponent'`
allows each player one waiting match; `match.create` checks first for the
friendly error, and abandons the caller's own expired waiting match so the
daily sweep's lag never blocks a new one. `match.code` is now only a label
(the editor names a draft after it, lists tell matches apart by it); nothing
joins by it. See the [match lobby spec](2026-10-23-match-lobby-design.md).

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

A player keeps **at most 10 labyrinths**, in every state. A used maze can be
deleted: `maze.deletedAt` hides it from its author at once, and the nightly
cron purges the row once every match that used it ended at least 30 days ago
(`match.endedAt`); `match_player.maze_id` is `ON DELETE SET NULL` for that.
See `2026-10-23-labyrinth-library-design.md`.

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

There is no `runStatus` column: not started, running, finished and gave up are `startedAt`, `finishedAt` and `gaveUpAt` being set or not, and penalties and the move count live inside `runState`. Phase 4 settled both, for the same reason Phase 3 left out a stored unlock time: a copy of a derivable value is a second source of truth. `move.delta` stores the runner's delta verbatim, which is what a retry must get back (§7.2).

## 7. Move protocol and anti-cheat

`run.move({ matchId, seq, dir })`:

1. Load `runState` and the opponent's maze.
2. Apply the pure reducer.
3. Write the `move` row and the updated `runState` in one transaction.
4. Publish the delta to the realtime channel (§8).
5. Return **only the delta**: outcome, new position if it moved, the single
   segment or cell revealed, any key acquired, the running penalty count.

The run's procedures (`run.get`, `run.move`, `run.giveUp`, `run.result`) live on their own router.

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

### 7.3 No optimistic movement for unknown edges

The client genuinely does not know whether a wall is there — that is the game.
Guessing and rolling back would flicker the map and sometimes draw a wall that
does not exist. The board's map therefore changes only from server deltas for
any edge the runner has not yet walked through.

The delay is hidden in two ways instead:

- **Known passages move instantly.** The discovered map records every edge the
  runner has walked through (`passages`, start-relative, a crossed gate
  included). A move through one has a certain answer, which `predictMove`
  computes from the runner's own map; the client draws it at once, still sends
  the move with its `seq`, and reconciles. A matching answer changes nothing;
  any disagreement or refusal falls back to refetching `run.get`. A predicted
  move never bumps. Several such moves may run ahead of the server; a move
  over an unknown edge waits for its own answer, and nothing past it is
  predicted until then.
- **Lean, then resolve.** On a key press over an unknown edge the runner leans
  about a third of a cell toward it (~90 ms) and holds; the answer either
  slides it into the new cell or springs it back with a bump pulse. The lean
  is cosmetic — the runner's logical position never moves before the server
  answers — and is skipped under reduced motion.

Held-key input is still queued as sequential `seq`-numbered moves, with one
move waiting behind an unknown edge.

The obvious alternative — ship the maze to the browser, encrypted, and let the
client resolve moves locally — is rejected outright. A browser that can
decrypt the maze to resolve a move holds the key, and so does the player
running it: encryption hides the maze from no one who can open the developer
tools. The server stays the only authority on unknown edges (§7.1).

## 8. Realtime, spectating and replay

On commit, the server publishes the move delta to a Pusher **presence** channel
scoped to `{ matchId, runnerId }`. The channel auth endpoint admits the runner
and the maze's author, the author only once their own run is over (below).

The runner subscribes to the same channel solely to read its member list — that
is the "someone is watching you" indicator, and it costs nothing extra because
presence is the transport's job.

**Replay is the same viewer component**, fed from the stored move log instead of
the socket, with a scrubber, play/pause and speed. Because runs are async the
author is usually offline while their maze is being solved, so replay is the
feature that will actually get used; live spectating is the same component with
a different source. Sharing the component is what stops the two drifting apart
visually.

**Watching opens when your own run is over.** A watching author sees their own
maze, which they already know, plus the runner's position within it, so they
learn nothing about the maze *they* still have to solve. But they do learn the
runner's progress — every bump, the running penalty count — and a player who
watched before running would play to a known target, which §9 exists to
prevent. So the author may join the runner's channel, and read their run
through `run.replay`, only once the author's own run has reached the treasure or
the match has ended. The first draft said watching needed no gating; that
missed the score, and Phase 5 corrected it.

One consequence is accepted: the runner's "1 watching" badge can only light up
once the opponent has finished, so it tells the runner that much. The deadline
already discloses the same fact (§9.1).

**Two channels.** `run-{matchId}-{runnerId}` (presence) carries each move's
delta with its `seq`; the runner joins it only for the member count, the author
to watch. `match-{matchId}` (private, both players) carries a payload-free
"changed" ping on join, submit, give-up, completion and cancel, so the waiting
screen and the matches list update live and an open run learns at once that the opponent gave up. Pings carry no
data — the client refetches through the ordinary procedures, so the channel can
disclose nothing they would not. A slow poll (60s) remains as the fallback for
a dropped connection.

**Two more channels** ([match lobby spec](2026-10-23-match-lobby-design.md)). `private-lobby` pings whenever the set of
waiting matches changes (create, join, accept, cancel) and `private-user_{id}`
pings one player about their own requests (accepted, declined, match gone).
Neither names a match, so `canSubscribe` decides them without a participant
check: the lobby is open to any signed-in user, a user channel only to its
owner. A requester is deliberately not admitted to the `match` or `run`
channels.

**Publishing never fails a move.** The server publishes after the transaction
commits; a publish error is logged and swallowed. A watcher who missed a delta
recovers it from the move log, deduplicating by `seq`.

**Replay timing is a fixed pace**, not the recorded intervals: an asynchronous
run can pause for hours between moves. 1× is four moves a second, with 2×, 4×
and 8×.

**Who can replay what.** During the match, the author can replay the
opponent's run through the author's maze — under the same gate as watching.
After the match, both players can replay both runs, under the result screen's
rule (§10.3.1): only once both mazes were submitted. Nobody outside the match
can watch or replay.

### 8.1 Publisher abstraction

The server publishes through a `RealtimePublisher` interface with two
implementations: Pusher in production, an in-process implementation in
development and test. Pusher in CI is flaky and rate-limited; the e2e suite runs
against the local implementation, with a single nightly smoke test against the
real service. This is the operational cost of choosing a realtime vendor, paid
deliberately.

"In-process" still has to reach a browser. Locally, the in-process bus feeds a
server-sent-events route (`/api/realtime/stream`), which also tracks presence
for its open connections; the client's `useChannel` hook picks `pusher-js` when
a Pusher key is configured and `EventSource` otherwise. One subscription rule
decides both Pusher's auth endpoint and the local stream, so the two cannot
disagree about who may listen. The local bus works within one server process,
which covers `next dev`, `next start` and the e2e suite; a deployment without
Pusher keys gets no live updates and falls back to polling, with a warning in
the server log.

## 9. Match lifecycle

```
awaiting_opponent → drawing → running → complete
                          ↘ abandoned (on expiry)
```

- `awaiting_opponent` — created, nobody has joined: the match is in the lobby
  (until its deadline), and a locked one may hold pending requests ([match lobby spec](2026-10-23-match-lobby-design.md)).
- `drawing` — both players present, each drawing. Settings frozen.
- `running` — both mazes submitted. Both runs unlock at once and proceed
  independently.
- `complete` — both `finishedAt` set, or one player finished and the other ran
  out of time, or one player gave up (§9.2). Only now is the result computed and
  revealed, so the second finisher cannot play to a known target.
- `abandoned` — closed with **no winner**. See §9.1.

**Cancelling a waiting match.** While a match is still `awaiting_opponent`, its
creator — the only player in it — can cancel it, from the matches list or the
lobby, after a confirmation. Cancelling deletes the match row (its one player
row cascades, and no maze was ever submitted to it), so the match leaves the lobby and its pending requests go with it (those
requesters are pinged on their user channel; a later join gets "match not
found"). `match.cancel` locks the
match row and re-checks the status, and `join` locks the same row, so a join
racing the cancel either lands first and the cancel is refused, or waits and
finds nothing. Any other status is refused (`errors.matchNotCancellable`);
what cancelling mid-`drawing` should mean to an opponent who already drew is
undecided (see the backlog).

### 9.1 Deadlines

| Situation | Deadline | Outcome |
|---|---|---|
| Nobody has joined | 24h from creation | `abandoned`, no winner |
| Both joined, neither has submitted a maze | 48h with no activity from either | `abandoned`, no winner |
| One submitted a maze, the other has not | 24h from that submission | `abandoned`, no winner; recorded against the player who did not draw |
| Both submitted, neither has made a single move | 24h from the runs unlocking | `abandoned`, no winner |
| Both have moved, neither has finished | 48h since the last move by either | `abandoned`, no winner |
| One has moved, the other has not | 24h from the later of the mover's last move and the unlocking | `abandoned`, no winner; recorded against the player who never moved |
| One found the treasure, the other has not | 24h from that finish | `complete`; the non-finisher loses, the finisher wins |

Two principles hold this together, and they resolve every case above.

**You cannot win without finding the treasure.** A player who misses a deadline
forfeits, but forfeiting does not hand the opponent a win unless that opponent
actually reached the treasure. That is why every row but the last closes with no
winner, including the case where you drew your maze and your opponent never drew
theirs. Missing a drawing deadline is recorded against the player who missed it —
which is what a future reliability or reputation stat would read — but it does
not put an unearned win on the other player's record. The one exception is a
player who explicitly gives up, which is a concession rather than an expiry —
see §9.2.

**Nothing expires while both players are still engaged.** Every deadline is
anchored to the last thing that actually happened, so an active match is never
timed out from under anyone.

The one-moved row was missing from the first draft of this table and was added
during Phase 3, when an implementer noticed the gap. The two principles above
settle it between them: a player who is moving **is** engaged, so the clock must
follow their last move rather than the unlocking, and the player who has not
started is the one it is running against. Without that row the implementation
fell through to "neither has moved", which would abandon an actively-playing
match at a fixed 24h from the unlocking and record fault against nobody.

A scheduled sweep evaluates these, so a stale match closes on its own rather
than waiting for someone to open it. It runs once a day — the finest schedule
Vercel's Hobby plan accepts — so a match closes up to a day after its deadline.
Nothing can change a match whose deadline has passed in the meantime: moves and
give-ups past it are refused.

The deadline a running player sees is the match's single `deadlineAt`, so it
moves with the opponent's run: a player can tell from it that the opponent has
finished (the clock drops to 24h from their finish). This is accepted. Hiding a
clock that is running against a player is worse than the disclosure, and it
reveals that the opponent finished, not their score. Phase 4 settled this.

### 9.2 Giving up

A player in a `running` match may give up at any point before they finish. It
is confirmed, irreversible, and **ends the match immediately**: status
`complete`, `endReason: forfeit`, and the opponent is the winner — exactly as if
they had found the treasure, whether they had already finished, were mid-run,
or had not yet moved. The opponent's run stops where it is, and the result
screen shows both partial runs and who gave up.

This is a deliberate exception to "you cannot win without finding the
treasure", and the exception is the point. That principle exists so that
*silence* — a missed deadline, a player who wandered off — never produces a win
nobody earned. Giving up is not silence; it is one player conceding to the
other, and a concession that did not award the match would be a button that
does nothing but wait out a deadline. The principle continues to govern every
row of §9.1.

The opponent learns of it from the result screen: their next move is refused
with `MatchOver`, and an open run view polls the match status and switches over
on its own. Since Phase 5 the match channel's ping delivers it at once (§8); the
poll remains as the fallback for a dropped connection.

A player who has already found the treasure cannot give up — there is nothing
left to concede.

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
`48 / 64 squares` counter.

**Detail mode** exposes the palette — wall, gate, key, start, treasure. Walls
and gates snap to edges; keys, start and treasure snap to cells. Clicking an
existing item with the active tool removes it, and an explicit eraser handles
the ambiguous cases.

**Strokes.** Paint, erase-square, wall and the eraser draw with a swipe: press,
drag, release. Every square or edge the pointer passes over is affected, with
the samples between pointer events filled in so a fast swipe leaves no gap.
Painting stops at the budget, for a swipe and a single click alike. A wall
stroke's first edge decides what the whole stroke does: starting on a wall
removes walls, starting anywhere else adds them, and revisiting an edge in the
same stroke never flips it back. Gate, key, start and treasure act on a single
tap. Each stroke is **one undo step**, however many squares or edges it
touched; a tap with a stroke tool is a one-edit stroke. The board sets
`touch-action: none` so a swipe on a phone draws instead of scrolling — the
board already fits the width, so losing pinch-zoom on it costs little.

**The outline is automatic.** Every edge with exactly one painted side —
including the frame border and the rim of any unpainted hole — is drawn as a
wall, because it is one (§2.3), and is recomputed from the painted cells on
every render. It is never stored, and it is never a target: edges take a wall
or a gate only when both sides are painted.

**Hover preview.** With a mouse, the target under the pointer shows faintly
what the active tool would do there: the square paint would fill or erase
would clear, the edge a wall or the chosen gate would land on, the wall, gate or
key the eraser would remove, the spot a key, start or treasure would take. On
touch there is no hover; the stroke itself is the feedback.

**Gate and key numbers.** With the gate or key tool active, the panel offers
one numbered, colour-swatched choice per gate the maze allows, 1 to its gate
count, each marked when already placed. Activating the tool selects the
lowest number not yet placed (or 1 when all are). Each placement then moves
the choice on to the lowest number still unplaced, so consecutive clicks place
1, 2, 3; a toggle-off, a refused placement, undo and redo leave it where it
is, and so does a placement once every number is down. Placing gate N where gate N already is elsewhere moves it, and
the editor never accepts a gate or key numbered outside 1 to the gate count.
A key may go down before its gate.

**Focus ring.** The board's own ring marks the focused square or edge, shown
for keyboard focus only. The browser's outline is turned off on the board:
drawn around an SVG `<rect>` it is clipped and rounded and cannot be styled.

Required, not optional:

- **Undo / redo.** Nobody places sixty walls without a mistake.
- **Draft autosave** to the maze row. Losing a half-drawn labyrinth to a page
  refresh is the kind of thing that ends someone's interest in an app.
  A status line says "Saving…" with a spinner until the server holds the
  live draft, then "Saved" — or, once the maze is also valid, that it is
  saved and ready to be used in a game.

**Drawing for a match.** The lobby's picker always offers "Draw a new one",
which creates a draft at the match's own size and gate count, named "Labyrinth
for match {code}", and opens it in the editor as `/labyrinths/{id}?match={matchId}`.
The editor page checks that match on the server: the caller is in it, it is in
`drawing`, they have not submitted, and its settings equal the maze's. If so,
the save-status area offers **Use in this match**, enabled only once the maze
is valid and saved; it asks for the same confirmation as the lobby, submits,
and returns to the match. If any check fails the parameter is ignored, with no
error. Each option in the picker is a row with a small, decorative preview
of that maze — the same drawing as the result screen's — beside its name.

The side panel runs the validator continuously and reports only facts, never
judgement: squares used against the budget, gates and keys placed, and whether
the maze is currently valid. Submit is disabled while invalid and names the
specific failure. There is deliberately no difficulty score and no advice about
gate placement (§4.3).

**Known risk:** edge hit targets on a phone. An edge is resolved as the nearest
of the containing square's four, within about 0.3 of a square and away from
the corners, where two edges are equally near. On a phone-width board a square
is little more than 20 px, so placing one wall by tap is fiddly even though a
swipe along a line of edges works well. With pinch-zoom off on the board there
is no zooming in to help; v1 does not close that gap — a native mobile client
is the intended answer, out of scope here.

### 10.3 Run view

The same board component with a different data source: discovered cells and
bumped segments instead of the full maze. Arrow keys and WASD on desktop, an
on-screen d-pad on touch. A one-line rule sits at the top — **Fewest bumps
wins.** Walking is free; a wall or a locked gate is a bump; equal bumps is a
draw. Bumps take the prominent position since they are the score; moves and
held keys (colour-matched to their gates) are secondary. A blocked move pulses
the runner briefly (about 200 ms, never left enlarged) and draws the segment
that stopped you.

On desktop (`lg` and up) the board is on the left and a right-hand column
(about 20rem) holds the rule, the bump counter, moves, keys, the watching
badge, the deadline, the d-pad and Give up. Narrower screens stack the same
parts in that order around the board.

The board shows at least 7 × 7 cells, centred on the runner, and grows to fit
every discovered cell, segment and passage with a cell of padding, easing the
change over about 200 ms. An edge between two discovered cells that is neither
a known segment nor a passage is drawn as a faint dashed line: untested, could
go either way. A key on a discovered cell has been collected (stepping on a
cell picks it up) and a drawn treasure has been reached, so both are drawn at
about 15% opacity. The watch view's runner board shares all of this.

"The same board component" is to be read as the same *look*, not the same
component: the editor board renders every square of the frame and labels each
painted or void, which in a run view would leak the shape into the
accessibility tree. The run board is a sibling that shares the cell size and
gate colours and is fed only what the runner has discovered. Its viewport grows
as the runner explores, because the frame's size is itself a secret.

A runner who finds the treasure sees their own score and a waiting state; the
opponent's score stays hidden until the match ends (§9). The finishing move
also opens a modal popup, once and never on a reload: "You found the
treasure!", their bumps, moves and time, and either that the result is revealed
when the opponent finishes or runs out of time (with a link to watch them
live), or — when that move completed the match — that the result is ready,
with a button to see it. Escape or Close dismisses it.

### 10.3.1 Result screen

Shown on `/matches/[id]` once the match is `complete` or `abandoned` — the one
URL renders the lobby, the run or the result by status. It gives the winner, or
"no winner" (a draw on equal bumps); the reason; both players' bumps, moves
and time side by side, with the bumps marked when they decided it; and **both mazes in full**, each with the
path its runner took drawn over it as a static polyline. The opponent's maze
with your path is the payoff of the game. Your maze with theirs is the poor
man's replay until §10.4 exists, and gives way to it then.

Each drawing is shown for as long as its maze exists; once its author has
deleted it and the 30-day replay window has closed, it is replaced by a short
"This labyrinth was deleted" note, while the scores always stay
(`2026-10-23-labyrinth-library-design.md`).

Both mazes are safe to show: the match is over, and a maze cannot be reused
against anyone who has faced it in a match that reached `running` (§6, as
implemented by `mazesFacedBy`).

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
runner sees a small "watching" badge fed from the presence member list.

Watching and replay share one page, `/matches/[id]/watch?run=opponent|mine`.
While the run is still going, new moves arrive live; a viewer at the end of the
timeline follows them, and one who has scrubbed back stays put with a "jump to
live" control. The entry points are the waiting screen after your own finish
("watch them live") and the result screen, which keeps its static path summary
(§10.3.1) and adds a replay link for each run. Replays are kept for 30 days
after the match ends; after that the links are gone and `run.replay` refuses
with `errors.replayExpired`.

### 10.5 Theming

Tailwind v4 CSS custom properties with `data-theme` on `html`. Tri-state
system / light / dark, persisted, with the standard inline script to prevent a
flash of the wrong theme. Maze colours are tokens, so the board themes itself.

On every board, **only keys and gates carry colour** — each pair its own hue,
so a key is matched to its gate at a glance. Everything else is drawn in the
neutral text colour: the start (a stairwell door), the treasure (a trophy),
the runner (a standing person, with no disc behind it), and the path on the
result and replay boards, which is a faint line rather than an accent one.
Icons are Lucide's.

The language and theme controls live together behind one settings button in
the header (a gear icon), for signed-in and signed-out visitors alike. It
opens a labelled panel; Escape closes it and returns focus to the button, and
a click outside closes it.

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

That list was written before any of it existed and proved too coarse. Phase 3
shipped eleven keys, because the cases a person needs told apart are finer than
the classes above: a code nobody recognises is not the same message as a match
that is already full, and "this labyrinth is the wrong size for this match" is
not the same as "this labyrinth is not playable yet". The rule that matters is
not the length of the list but that **every error is a key, translated in both
locales, and assertable by code rather than by copy** — keep that, and add keys
as the cases earn them.

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

The deadline rules in §9.1 get their own table-driven suite, one case per row,
with the clock injected rather than slept through. Phase 3 built it as a **unit**
suite rather than an integration one, which is better than what this section
originally said: the rules are pure functions over timestamps and do not need
Postgres to exercise them. The integration layer separately asserts that the
stored `deadlineAt` column agrees with what the function computes, which is the
part that genuinely needs a database. Six rules with
different anchors and two different durations is exactly the kind of thing that
quietly rots, and the one that matters most — a forfeit never producing a winner
who did not reach the treasure — is asserted directly rather than inferred.

**Playwright**, in two projects (desktop Chromium, mobile Safari viewport):

- sign-up, sign-in, sign-out
- the lobby, requests and share links (`e2e/matchmaking.spec.ts`): create an open
  or locked match, join from the lobby, request and accept or decline, open a
  share link signed out. See the [match lobby spec](2026-10-23-match-lobby-design.md)
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
| 3 — Match lifecycle | Create with settings, join by code (since replaced by the lobby), submit mazes, state machine, expiry. Two accounts reach `running`. |
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

**Random matchmaking.** Players always pick a match themselves, from the lobby
or a share link. The lobby itself shipped ([match lobby spec](2026-10-23-match-lobby-design.md)).

**OAuth sign-in.** Email and password only. See §5.1.

## 17. Decisions log

| Question | Decision |
|---|---|
| Who solves whose maze, and when? | Swapped mazes, asynchronous runs. "Turn" is a penalty counter, not an alternating turn order. |
| What does the runner learn, and when? | Bump-to-learn. Walls are invisible until walked into. |
| How strictly is "one path to the treasure" read? | At least one solution must exist, via the key-aware search. Loops and alternate routes allowed. |
| How do keys map to gates? | Matched pairs, colour-coded, one key per gate. |
| How do players meet? | The lobby (open matches join at once; locked matches take requests the creator accepts or declines) or a share link to a locked match. Creator sets the settings. |
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
| Giving up (Phase 4) | Allowed mid-run, confirmed, irreversible. Ends the match at once and the opponent wins, finished or not. A concession is not silence, so the no-unearned-wins rule does not apply to it (§9.2). |
| What the result reveals (Phase 4) | Scores, winner, reason, and both full mazes with each runner's path drawn over them. |
| Perfect tie | No winner. Superseded by the scoring change below: any tie on bumps is a draw. |
| Scoring (revised) | Bumps only. Fewest bumps wins; equal bumps is a draw. Moves and time are shown, never scored — the earlier moves-then-time tiebreak is gone. |
| Client-side maze for faster moves | No, not even encrypted. A browser that can decrypt the maze to resolve moves gives the key to the player. Delay is hidden by instant moves through known passages and a lean-then-resolve animation instead (§7.3). |
| Watching (Phase 5) | Only once your own run is over — before that the opponent's live score would be a known target (§8). Pace-based replay, 1×–8×. |
| Spectating layout | Two boards side by side — the runner's fogged view and the author's full maze — because authors do not remember their own walls. |
| Connectivity rule | Shape must be orthogonally connected and the treasure must be reachable. Sealed pockets allowed. |
| ORM | Drizzle. |
| Auth library | Better Auth (deviation from stock T3, accepted). |
| Library size and retention | At most 10 labyrinths per player, used ones included; used ones can be deleted. Replays last 30 days after a match ends; a deleted maze's drawing leaves old results then, and its row is purged. Results stay forever. |
