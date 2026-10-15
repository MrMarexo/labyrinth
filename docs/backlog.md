# Backlog

Spec requirements and niceties that were deliberately deferred, each with the
reason and the phase that deferred it. A deferral that lives only in a per-phase
plan is one nobody finds again — Phase 2 learned that, and Phase 3 repeated it —
so this file is the standing list. When a phase picks one up, delete it here.

## Waiting on a later phase

- **Live lobby updates** (Phase 3). The lobby neither polls nor subscribes; a
  player refreshes to see their opponent's submission land. Joins the realtime
  layer in Phase 5.
- **Live "opponent gave up" push** (Phase 4). Until the realtime layer exists the
  run view learns of it by polling and by its next move being refused. Phase 5.
- **Rematch, and reusing a maze from a finished match's result screen**
  (Phase 3). Needed a result screen, which Phase 4 adds.

## Product, not yet scheduled

- **Cancelling a match you created** (Phase 3). The 24h sweep closes an unjoined
  match on its own. Needs its own thinking about what cancelling mid-`drawing`
  means to an opponent who already drew.
- **Notifying a player who is not on the page** (Phase 4) — email or push when
  the opponent gives up, finishes, or a deadline is near.
- **Points, rating or win records** (Phase 4). A win is currently `winnerId` on
  a match and nothing more.

## Technical

- **ICU pluralisation across every counted string, in both locales** (Phase 2,
  carried through Phase 3). Slovak distinguishes one / two-to-four / five-plus.
  `3ee8a98` fixed match sizes and gate counts; audit the rest of both catalogues
  in one pass.
- **DB-level constraints on `match.status` and `maze.status`, and an
  `updated_at` trigger** (Phase 3). The enums live only in the Drizzle types.
- **An index on `maze (author_id, content_hash)`** (Phase 3), once the library
  is large enough for the reuse lookup to matter.
