# Backlog

Spec requirements and niceties that were deliberately deferred, each with the
reason and the phase that deferred it. A deferral that lives only in a per-phase
plan is one nobody finds again — Phase 2 learned that, and Phase 3 repeated it —
so this file is the standing list. When a phase picks one up, delete it here.

## Product, not yet scheduled

- **Rematch, and reusing a maze from a finished match's result screen**
  (Phase 3; the result screen now exists, Phase 4).
- **Cancelling a match you created** (Phase 3). The 24h sweep closes an unjoined
  match on its own. Needs its own thinking about what cancelling mid-`drawing`
  means to an opponent who already drew.
- **Notifying a player who is not on the page** (Phase 4) — email or push when
  the opponent gives up, finishes, or a deadline is near.
- **Points, rating or win records** (Phase 4). A win is currently `winnerId` on
  a match and nothing more.
- **A key cell re-announces its key on every visit** (Phase 4). The reducer
  reports `moved_found_key` each time a runner steps onto a key cell they have
  already emptied, and the run view announces it. That is harmless, but it reads
  oddly. The fix belongs in the reducer, and it changes the stored delta, so it
  needs a replay-compatibility thought first.

## Technical

- **ICU pluralisation across every counted string, in both locales** (Phase 2,
  carried through Phase 3). Slovak distinguishes one / two-to-four / five-plus.
  `3ee8a98` fixed match sizes and gate counts; audit the rest of both catalogues
  in one pass.
- **DB-level constraints on `match.status` and `maze.status`, and an
  `updated_at` trigger** (Phase 3). The enums live only in the Drizzle types.
- **An index on `maze (author_id, content_hash)`** (Phase 3), once the library
  is large enough for the reuse lookup to matter.
- **The run board's "nothing undiscovered" rule has no browser-level test**
  (Phase 4). The router tests prove `run.get` returns only discovered cells, but
  nothing proves `RunBoard` draws only what it is given. An e2e test that counts
  `[data-run-cell]` against moves made would close it.
- **The e2e "result waits for both" check is instantaneous** (Phase 4). It
  asserts the opponent's result is absent right after the host finishes, before
  any poll has run, so it proves less than its title; the router tests cover the
  rule server-side. Fix: wait for the next `match.get` poll response, then assert.
- **Identical consecutive run announcements are not re-read** (Phase 4). The
  board is `aria-hidden`, so a second "Moved." in a row is silence for a
  screen-reader user. Fix with a nonce or alternating wrapper, or the move count
  in the text. Phase 6.
- **Phase 3's `match.join` and `match.submitMaze` take no row locks**. The sweep
  closing a `drawing` match could race a submission; lock the way
  `participantRows(…, { lock: true })` does.
- **Rolling back to pre-Phase-4 code after runs exist**. The old sweep ignores
  `lastMoveAt` and `finishedAt` and would abandon active runs at row 4; the
  expand-only migration rule covers forward deploys only.
- **Pusher keys are not configured** (Phase 5). Production has no live updates
  until a Pusher app exists and its six variables are set (AGENTS.md, Realtime).
- **`pusher-js` ships to every client** (Phase 5), even when Pusher is not
  configured. A dynamic import inside `useChannel` would drop it from the bundle.
- **`e2e/run.spec.ts` still describes the result reaching the host "on its next
  poll" with a 30s wait** (Phase 5). Pushes now deliver it in seconds, so tighten
  the wording and timeout when next touching that file.
- **The Pusher half of `useChannel` is untested in the app** (Phase 5). Only the
  nightly smoke test touches real Pusher, and it does not go through
  `useChannel`. A preview-deployment e2e with keys would cover it.
