# Labyrinth — instructions for agents

Two players each draw a secret maze, then race through the other's. See
`docs/superpowers/specs/2026-09-22-labyrinth-design.md` for the full design;
plans live in `docs/superpowers/plans/`.

## Commands

| Command                 | What it does                                             |
| ----------------------- | -------------------------------------------------------- |
| `pnpm dev`              | Development server                                       |
| `pnpm typecheck`        | `tsc --noEmit`                                           |
| `pnpm lint`             | ESLint                                                   |
| `pnpm format`           | Prettier, writing in place                               |
| `pnpm test`             | Vitest unit tests (Node environment, no database)        |
| `pnpm test:integration` | Vitest against a real Neon branch — needs `DATABASE_URL` |
| `pnpm e2e`              | Playwright, desktop and mobile projects                  |
| `pnpm db:generate`      | Generate a migration from the schema                     |
| `pnpm db:migrate`       | Apply migrations                                         |

Use pnpm. Never `npm install`.

## Layout

```
src/maze/          Pure domain: format, validator, solver, move reducer
src/server/db/     Drizzle client and schema
src/server/auth/   Better Auth configuration
src/server/api/    tRPC routers
src/app/[locale]/  Pages, locale-prefixed
  (auth)/          Sign in and sign up
  (app)/           Everything requiring a session
src/components/    Shared components
messages/          en.json, sk.json
e2e/               Playwright
tests/unit/        Vitest, no database
tests/integration/ Vitest, real database
```

## Invariants

These are not style preferences. Breaking one is a bug, and most of them fail
quietly rather than loudly.

1. **No procedure reachable by a runner may select `maze.data`.** The maze is
   secret; a runner learning it ends the game. Author-facing and runner-facing
   reads are separate procedures with separate return types.
2. **`src/maze/` imports nothing** from Next, React, tRPC or Drizzle. It is
   pure functions over plain data, shared by the server, the live spectator
   view, the replay view and eventually a mobile client. ESLint enforces this.
3. **Validation failures travel as i18n message keys with parameters, never as
   English strings.** Applies to tRPC errors and to anything rendered.
4. **The move log is the source of truth.** `match_player.runState` is a
   denormalised cache. Never fix a discrepancy by editing the cache.
5. **Both players in a match share `cellCount` and `gateCount`.** Always.
6. **A void-blocked move must be indistinguishable from a wall-blocked move**
   in everything the runner receives and everything the client renders. This is
   the difference between a hidden maze and a guessable one.
7. **You cannot win without finding the treasure.** A forfeit never produces a
   winner who did not reach it. `winnerId` is null for every `abandoned` match.
8. **Database access uses `drizzle-orm/neon-serverless` with `Pool`**, never
   `neon-http`. The HTTP driver cannot open an interactive transaction, and
   moves must commit atomically with their run state.
9. **Every user-visible string lives in `messages/`.** Both catalogues, always
   — a unit test fails the build if `sk` drifts from `en`.
10. **Colours come from the tokens in `src/styles/globals.css`.** A raw hex
    value in a component will not follow the theme.

## Testing

Three layers, chosen by what each can actually prove:

- **`tests/unit/`** — pure logic, Node environment. The domain layer lives here
  and is tested with property-based tests as well as examples.
- **`tests/integration/`** — real Postgres on a Neon branch. Routers, auth,
  deadlines.
- **`e2e/`** — real browser, desktop and mobile. All UI behaviour.

There is deliberately no jsdom and no React Testing Library. UI behaviour is
proved in a real browser or not at all.

Write the failing test first. Run it and watch it fail before implementing.
