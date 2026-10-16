# tRPC routers

**No procedure reachable by a runner may select `maze.data`.** The maze is
secret; a runner who learns it has ended the game. Author-facing and
runner-facing reads are separate procedures with separate return types.

Nothing enforces this mechanically — no lint rule, no type. Check it by hand
on every procedure that touches a maze, and say so in the review.

Root `AGENTS.md`, invariant 1.

## The two sanctioned readers

`run.move` reads the opponent's `maze.data` to apply the reducer, and returns
only a `RunnerDelta`. `run.result` returns both mazes, and only for a terminal
match in which both players submitted. Those are the only two. A new procedure
that needs the maze is a design conversation, not an implementation detail.

`run.get` is the runner's read and must stay free of `maze.data`: everything it
returns comes from `runState.view`, which is built only from deltas the runner
was already sent.
