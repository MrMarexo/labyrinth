# tRPC routers

**No procedure reachable by a runner may select `maze.data`.** The maze is
secret; a runner who learns it has ended the game. Author-facing and
runner-facing reads are separate procedures with separate return types.

Nothing enforces this mechanically — no lint rule, no type. Check it by hand
on every procedure that touches a maze, and say so in the review.

Root `AGENTS.md`, invariant 1.

## The sanctioned readers

`run.move` reads the opponent's `maze.data` to apply the reducer, and returns
only a `RunnerDelta`. `run.result` returns both mazes, and only for a terminal
match in which both players submitted. `run.replay` returns one maze: for `whose: "opponent"` the caller's own maze, which they drew, and for `whose: "mine"` the opponent's, only once the match is terminal and both submitted — the result screen's rule. Its gates are `mayWatchOpponent` and `mayReplayOwn` in `src/match/watch.ts`.

Both are bounded in time (`src/match/retention.ts`): `run.replay` refuses
once `replayExpired(match.endedAt)`, 30 days after the match ended, and
`run.result` drops a drawing whose maze its author deleted once that window
has closed (`drawingDeleted`), while still returning the scores. A purged
maze leaves `match_player.mazeId` null, so neither may assume it is set.

Those are the only three. A new procedure
that needs the maze is a design conversation, not an implementation detail.

`run.get` is the runner's read and must stay free of `maze.data`: everything it
returns comes from `runState.view`, which is built only from deltas the runner
was already sent.

## Author-facing reads

`maze.get` and `match.eligibleMazes` also return `maze.data`, but only for
mazes whose `authorId` is the caller — their own drawings, for the editor and
the lobby picker's previews. Both filter on the author in the query itself.
Keep that filter first, and never widen either to someone else's maze.
