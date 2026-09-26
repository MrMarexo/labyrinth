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
11. **Pages and components never import the database client.** `~/server/db` is
    reachable only from `src/server/**`. Everything under `src/app/` and
    `src/components/` goes through a tRPC procedure. Layouts are exempt because
    they read the session directly via `~/server/auth`.

## Schema notes

Two decisions that look like oversights and are not.

- **`user.email` is plain `text`, where spec §6 says `citext`.** The
  case-insensitivity comes from Better Auth 1.7.5, which lowercases the
  address on both the sign-up and the sign-in path, not from the column. The
  behaviour is equivalent _only through the library_. A raw query — a
  Drizzle `eq(user.email, …)`, an admin script, a future magic-link lookup —
  is case-sensitive and will miss. Lowercase the input yourself, or move the
  column to `citext` first.
- **`user.locale` is nullable, and in practice never null.** Null means
  "never chosen", which has to be representable so the app can tell it apart
  from "chose English". Sign-up then immediately writes the locale the form
  was in, because signing up in a language _is_ a choice — so no user created
  through the UI has a null. That is intentional, not a bug in the sign-up
  path: the null case is there for users created by other means later
  (seeds, an invite flow, an admin tool).

## Local environment

**Never run `vercel env pull` in this project.** It writes `.env.local`, which
Next.js prefers over `.env`, but the Vitest integration setup reads `.env`
specifically. Vercel's Development-scoped `DATABASE_URL` is managed by the Neon
integration and points at the production branch, so pulling it leaves the app
talking to production while the integration tests talk to `dev` — in one
checkout, with no error and no warning.

Keep `.env` hand-maintained, pointing at your own Neon `dev` branch. Both
`DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct, used by
drizzle-kit for migrations) must name the same branch; one of each is worse
than both wrong, because migrations would then run against a different
database than the app reads.

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

## CI

Every pull request runs types, lint, formatting and unit tests, then
integration and end-to-end tests against a Neon branch created for that run and
deleted afterwards. Migrations are applied to the branch first, so a broken
migration fails the pull request.

Requires the repository secrets `NEON_API_KEY`, `NEON_PROJECT_ID` and
`BETTER_AUTH_SECRET`.

### Migrations on deploy

Vercel runs the `vercel-build` script in preference to `build` when one
exists, so migrations are part of every deployment:

```
"vercel-build": "drizzle-kit migrate && next build"
```

This is how migrations reach production at all — `db:migrate` is a manual
local command, and CI only ever migrates the throwaway branch it created for
that run. It also covers preview deployments, whose Neon branches are cloned
from production and therefore need the pull request's own migrations before
the app on them will work.

`drizzle.config.ts` connects with `DATABASE_URL_UNPOOLED`, so
**`DATABASE_URL_UNPOOLED` must be present in every Vercel environment scope**
— Production, Preview and Development. It is not optional there the way it
looks locally: a scope missing it fails the build in `drizzle-kit migrate`,
before `next build` runs. Importing `env` also means `DATABASE_URL` and
`BETTER_AUTH_SECRET` must be set in the same scope.

A failed migration fails the deploy and the previous deployment keeps
serving. The migration is not rolled back, so migrations must stay backwards
compatible with the code already running — expand first, contract in a later
deploy.
