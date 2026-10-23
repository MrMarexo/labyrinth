# Labyrinth library: filters, a 10-labyrinth limit, and replay expiry

Date: 2026-10-23. Amends the main design
(`2026-09-22-labyrinth-design.md`, §6, §10.3.1, §10.4) where noted.

## Why

`/labyrinths` is one unsorted row of tiles with no way to tell, at a glance,
which labyrinths are unfinished, which are ready to play and which are locked
because a match used them. The owner wants to find the right one quickly, and
wants the library kept small: every player is capped at 10 saved labyrinths.

A cap only works if a player can always get back under it. Today a labyrinth
used in a match can never be deleted, because finished matches and their
replays read it. So this change also lets used labyrinths be deleted, and
bounds how long a match keeps needing its labyrinths: replays now last 30
days after a match ends, then go away.

## Goals

1. Filter `/labyrinths` by state, by square count and by gate count, and sort
   it.
2. One shared tile component for the `/labyrinths` list and the match lobby's
   picker.
3. At most 10 labyrinths per player, counting every state.
4. Any labyrinth, including a used one, can be deleted.
5. Replays stop 30 days after a match ends. The result stays, and so does
   each labyrinth's drawing on the result screen unless its author deleted
   it.
6. A used labyrinth the player deleted is removed from the database for good
   once no match can show it any more.

## Non-goals

- Pagination. With at most 10 labyrinths it would only hide tiles. (Asked for
  before the cap was agreed; dropped as the builder-writer's call — see
  "Calls made" below.)
- Editing a used labyrinth, or duplicating one to edit. §6 stands.
- Changing how matches, runs or scoring work.
- Deleting old matches. Matches stay in the history forever, with results.

## Anti-goals

- A player stuck at 10 with no way to free a slot.
- A running or recently finished match losing the labyrinth it needs: a move,
  a watch, a replay or a result screen failing because the maze row is gone.
- A deleted labyrinth still appearing anywhere the player can pick or open it.
- Breaking invariant 1: the new list and filters are author-facing reads of
  the caller's own mazes only.

## Labyrinth states

Three states, each derived from columns that already exist. Nothing new is
stored for them.

| State | Shown as (en / sk) | Derived from | Editable | Pickable for a match |
|---|---|---|---|---|
| Draft | Drafts / Koncepty | `status = 'draft'` and `contentHash IS NULL` | yes | no |
| Ready | Ready / Pripravené | `status = 'draft'` and `contentHash IS NOT NULL` | yes | yes |
| Used | Used / Použité | `status = 'submitted'` | no | yes, same rules as today (not against an opponent who has faced it) |

Labels are the builder-writer's suggestion; the owner may rename them.
A Used tile shows a small lock icon or "Used" label so its read-only state is
visible before opening it.

## `/labyrinths` list

- **State filter:** All (default), Drafts, Ready, Used. A segmented control,
  one choice at a time.
- **Size filters:** squares and gates, each a select listing only the values
  the player's own labyrinths actually have, plus "Any" (default). No free
  number input, so a filter can never name a size the player does not own.
- **Sort:** last edited (default, newest first), name (A–Z), size (squares,
  then gates, ascending).
- Filtering and sorting happen in the browser over `maze.list`, which already
  returns all of the caller's labyrinths; at 10 or fewer there is nothing to
  gain from doing it on the server.
- An empty result after filtering shows a short message distinct from the
  existing "You have not drawn any labyrinths yet."
- Filter and sort state may live in the URL query (shareable, survives a
  reload) or in component state — builder's choice.

## Shared tile

A `MazeTile` component used by both `src/components/editor/maze-list.tsx` and
`src/components/match/maze-picker.tsx`. It owns the frame (`rounded-lg
border-2 p-2`), the name on top, and the preview below (with the grey
placeholder square when the drawing is incomplete). Width is `w-40 sm:w-44`
in both places — the current `/labyrinths` width.

Each caller adds what is its own: on `/labyrinths` the links, the size
summary, the state marker and Delete; in the picker the radio role, keyboard
handling, click-again-to-deselect and the accent border when selected. The
tile must work both as a `<li>` with links inside and as a `<button
role="radio">`; how it is parameterised (render prop, `as` prop, children
slots) is left to the builder.

## The 10-labyrinth limit

- Counts every labyrinth the player has that is not deleted: drafts, ready
  and used.
- Enforced on the server in `maze.createDraft` and `maze.draftForMatch`,
  inside the same transaction as the insert, so two tabs cannot both create
  the 10th. Refused with an i18n key (invariant 3), e.g.
  `errors.mazeLimitReached` with `{ limit: 10 }`.
- A count-then-insert in one READ COMMITTED transaction is not race-safe on
  its own; take a lock that serialises one player's creations (for example
  `SELECT … FOR UPDATE` on their `user` row) before counting.
- `draftForMatch` reusing an existing empty draft is not a creation and is
  allowed at the limit.
- The UI shows the count (e.g. "7 / 10") on `/labyrinths`. At the limit the
  "New labyrinth" form and the lobby's "Draw a new one" are disabled with a
  line saying to delete one first. The server refusal remains the real guard.
- Players who already have more than 10 keep them all; they just cannot
  create another until they are below 10.
- The limit is a single named constant, not a literal repeated across files.

## Deleting

- **Draft or Ready:** deleted for good immediately, as today.
- **Used:** soft-deleted. A new nullable `maze.deletedAt` timestamp is set.
  From that moment the labyrinth:
  - no longer appears in `maze.list`, `match.eligibleMazes` or anywhere else
    the author can pick or open it;
  - no longer counts toward the limit;
  - is refused by `maze.get`, `saveDraft`, `submitMaze` and `remove` as if it
    did not exist (`notYourMaze`-style refusal, so its existence is not
    revealed);
  - is still readable by the match-side procedures (`run.*` moves, watch,
    replay, result) for as long as those procedures are allowed to show it.
- The delete confirmation for a Used labyrinth may say that past matches keep
  their results; wording is the builder's.

## Replay expiry (amends §10.3.1, §10.4)

- A match's **end time** is when it became terminal (`complete` or
  `abandoned`). The schema has no column for this today. The builder decides
  whether to add `match.endedAt` (set in the same statement that makes the
  match terminal: `resolveCompletion`, give-up, and the sweep) or derive it;
  note §6's stance against stored copies of derivable values, and that a
  sweep-closed match has no player timestamp to derive from. All three
  terminal paths already set `lastActivityAt: now`, which makes it a
  reasonable backfill source for matches already terminal when this ships.
  Matches that ended more than 30 days before deploy lose their replays
  immediately; that is accepted.
- `submitMaze` must refuse a soft-deleted maze inside its transaction, so a
  delete racing a submit cannot leave a deleted maze submitted.
- For 30 days after the end time, nothing changes.
- After 30 days:
  - `run.replay` refuses, with a new i18n key (e.g. `errors.replayExpired`).
  - The watch/replay page shows that message instead of the boards.
  - The result screen still shows the winner, reason, and both players'
    bumps, moves and time. The replay links are gone.
  - Each of the two maze drawings (with its runner's path) is decided on its
    own: it stays for as long as that labyrinth exists and was not deleted
    by its author. A drawing whose labyrinth was deleted (soft-deleted and
    past the window, or already purged) is replaced by a short "This
    labyrinth was deleted" note, while the other drawing still shows. Owner's
    decision: e.g. you deleted yours, your opponent kept theirs → theirs is
    drawn, yours shows the note, and vice versa.
  - Within the 30 days a soft-deleted labyrinth still draws and replays
    normally; deletion only takes effect on the match once the window
    closes.
  - So `run.result` must handle each maze independently: present, or gone
    (null `mazeId` after purge, or `deletedAt` set and past the window).
  - Realtime subscription rules are unaffected: a terminal match has no live
    channels anyway.
- "30 days" is a single named constant (`REPLAY_RETENTION_DAYS` or similar),
  measured as 30 × 24 h from the end time.
- The expiry rule and the per-drawing visibility rule are pure functions in
  `src/match/` (beside `mayReplayOwn`), unit-tested without a database, and
  used by the replay and result procedures.

## Purging deleted labyrinths

- The existing nightly cron (`/api/cron/sweep`, 03:00 UTC) gains a second
  step: hard-delete every maze with `deletedAt` set where **every** match
  that references it is terminal and ended more than 30 days ago. A maze
  referenced by any open match is never purged, whatever its `deletedAt`.
- `match_player.maze_id` is `ON DELETE RESTRICT` today. It changes to
  `ON DELETE SET NULL`. After purge, `match_player.mazeId` is null for that
  player; result and replay code must tolerate a null `mazeId` on a match
  past its replay window (they will not read it, by the expiry rule above).
  Note `mazeId` null currently also means "not submitted yet" — code that
  decides "has submitted" must use `submittedAt`, not `mazeId`. The builder
  should audit for any `mazeId !== null` used as a submitted check.
- Purge only ever removes soft-deleted mazes, so a labyrinth its author kept
  is never purged and its drawing on old results stays forever.
- `mazesFacedBy` loses the link for purged mazes. That is safe: a purged maze
  can never be picked again.
- Batched like the match sweep, so a backlog drains over several nights
  within the cron's time budget.
- Expand-then-contract (AGENTS.md "Migrations on deploy"): adding `deletedAt`,
  adding `endedAt` if chosen, and relaxing the foreign key are all additive
  and safe against the code already running.

## Already done in the working tree (uncommitted)

From earlier in this session, on branch `ux-batch`: the picker's "Use this
labyrinth" button only appears once a labyrinth is selected; clicking the
selected tile deselects it; the picker heading is "Labyrinths you can use";
the global hover tint fades instead of growing from the edges. These e2e
tests have not been run yet, because a dev server on port 3000 blocked the
test server.

## Testing

Per AGENTS.md: domain rules (state derivation, the expiry function) as unit
tests; the limit, soft delete, purge, foreign key change and replay refusal
as integration tests against Neon; filters, sorting, the tile, the limit UI
and an expired result screen with one labyrinth deleted and the other kept, in Playwright, desktop and mobile. Every new
string in both `en.json` and `sk.json`.

## Left to the builder

- Tile parameterisation, filter control styling, and where filter state
  lives.
- `endedAt` column versus derivation, and its backfill.
- Purge batch size.
- Exact copy for new messages, in both languages.

## Calls made by the writer (not confirmed by the owner)

- Pagination dropped because of the 10-labyrinth limit.
- Sort options: last edited, name, size.
- State labels Drafts / Ready / Used.
- Tile width `w-40 sm:w-44` everywhere.
- Users already over 10 are grandfathered.
