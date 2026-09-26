# tRPC routers

**No procedure reachable by a runner may select `maze.data`.** The maze is
secret; a runner who learns it has ended the game. Author-facing and
runner-facing reads are separate procedures with separate return types.

Nothing enforces this mechanically — no lint rule, no type. Check it by hand
on every procedure that touches a maze, and say so in the review.

Root `AGENTS.md`, invariant 1.
