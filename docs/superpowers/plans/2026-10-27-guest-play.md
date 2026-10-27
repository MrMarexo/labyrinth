# Guest Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone without an account join a match as "Guest 4821", draw a maze for it and play it, without a library or history, and carry the match over when they sign up.

**Architecture:** Better Auth's `anonymous` plugin makes a guest a real `user` row with `isAnonymous = true`, so seats, moves and realtime work unchanged. A new `memberProcedure` refuses guests on everything they may not use, and a public `viewer.get` tells pages who is looking. A guest's submitted maze is marked deleted at submission, so the existing nightly purge removes it after the replay window. `onLinkAccount` moves a guest's rows to the account they sign up or sign in to.

**Tech Stack:** Next.js App Router, tRPC, Drizzle (neon-serverless Pool), Better Auth 1.7.5 (`better-auth/plugins` `anonymous`, `better-auth/client/plugins` `anonymousClient`), next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-guest-play-design.md`. Read it first; this plan does not repeat its reasoning.

## Global Constraints

- AGENTS.md invariants hold. In particular: no new procedure reads `maze.data` except author-facing ones filtered on the caller (1); errors are message keys (3); every string in both `en.json` and `sk.json` (9); pages and components never import the db (11); `canSubscribe` is unchanged (12).
- Use pnpm. Never run `vercel env pull`.
- The new error key is exactly `errors.guestNotAllowed` (en: "Sign up to do this.", sk: "Na toto sa musíte zaregistrovať.").
- The guest's display name is the message `players.guestName`: en `"Guest {number}"`, sk `"Hosť {number}"`. `user.name` for a guest stores only the number, four digits, `1000`–`9999`.
- `viewer.get` returns exactly `{ kind: "visitor" } | { kind: "guest"; number: string } | { kind: "member" }`.
- A guest is created only by "Join as guest" / "Request as guest", never by a page view.
- Guests with no `match_player` row are deleted 30 days after `user.createdAt`. A guest who has a seat is never deleted by any cleanup.
- Linking is never refused for the 10-labyrinth limit.

## Review Focus

1. **A guest clicks "Join as guest", the join fails (the match filled), and they click a Join elsewhere.** They are already a guest, so the second click must call `match.join` without signing in again; the plugin refuses a second anonymous sign-in. Test in Task 7.
2. **A guest signs up while their run is in progress.** The account's `run.get` returns the same run state and `run.move` continues at the next `seq`. Test in Task 6.
3. **A guest who already submitted signs up before the match ends.** The maze is undeleted and the opponent's result still shows it after 30 days. Test in Task 6.
4. **A guest tries a wrong password when signing in to an existing account.** Nothing links, and the guest session and seat are untouched. Test in Task 6.
5. **A visitor on `/matches`.** No realtime auth requests fail and no console errors appear: lobby and user channels are not subscribed without a session. The lobby still updates by polling. Test in Task 8 (e2e).

Branch: create `guest-play` from `main`.

---

### Task 1: Guest identity — plugin, column, `memberProcedure`, `viewer.get`

**Files:**
- Modify: `src/server/db/schema/auth.ts` (`user.isAnonymous: boolean("is_anonymous").notNull().default(false)`), `src/server/auth/index.ts` (or wherever `betterAuth({…})` lives), `src/lib/auth-client.ts`, `src/server/api/trpc.ts`, `src/server/api/root.ts`, `messages/en.json`, `messages/sk.json`
- Create: `src/server/api/routers/viewer.ts`, migration via `pnpm db:generate` (`drizzle/0010_*.sql`)
- Test: `tests/integration/guest.test.ts`, `tests/integration/players.ts`

**Interfaces:**
- Produces:
  - `memberProcedure` in `src/server/api/trpc.ts`: `protectedProcedure` plus `ctx.session.user.isAnonymous` → `TRPCError({ code: "FORBIDDEN", message: "errors.guestNotAllowed" })`.
  - `viewer.get` (`publicProcedure`), the type in Global Constraints.
  - `guestSignedIn()` in `tests/integration/players.ts`: like `signedIn()`, via `auth.api.signInAnonymous({ asResponse: true })`.
  - Client exports `signIn.anonymous` through `anonymousClient()` added to `createAuthClient`'s plugins.

- [ ] **Step 1: Write failing tests** in `guest.test.ts`:
  - `guest sign-in makes an anonymous user with a four-digit name`: `ctx.session.user.isAnonymous === true`, `name` matches `/^[1-9]\d{3}$/`.
  - `viewer.get` returns `{ kind: "visitor" }` with no session, `{ kind: "guest", number: <name> }` for a guest, and `{ kind: "member" }` for `signedIn()`.
  - Anonymous sign-in is allowed 10 times in a row from one IP (custom rule; skip if `E2E_DISABLE_RATE_LIMIT` disables the limiter in the test env, and say so in the test).
- [ ] **Step 2:** `pnpm test:integration tests/integration/guest.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
  - `anonymous({ generateName: () => String(1000 + randomInt(9000)), disableDeleteAnonymousUser: true })`, placed before `nextCookies()` (which must stay last). Leave `onLinkAccount` for Task 6.
  - `rateLimit.customRules: { "/sign-in/anonymous": { window: 60, max: 20 } }`, merged so `disableRateLimit` still switches the limiter off.
  - Column, migration (`pnpm db:generate`, then `pnpm db:migrate`), `memberProcedure`, `viewerRouter` registered as `viewer`, and the error key in both catalogues.
- [ ] **Step 4:** Tests pass; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** — `feat: guest sessions, memberProcedure and viewer.get`.

### Task 2: What a guest may not do

**Files:**
- Modify: `src/server/api/routers/match.ts` (`create`, `list`), `src/server/api/routers/maze.ts` (`list`, `createConcept`, `editAsConcept`, `saveConcept`, `remove`), `src/server/api/routers/profile.ts` (all)
- Test: `tests/integration/guest.test.ts`

**Interfaces:**
- Consumes: `memberProcedure`, `guestSignedIn()` (Task 1).
- Produces: `match.list` for a guest returns only rows where `!isTerminal(status)`. Same shape as now.

- [ ] **Step 1: Write failing tests:**
  - `guest is refused …`: each of `match.create`, `maze.list`, `maze.createConcept`, `maze.editAsConcept`, `maze.saveConcept`, `maze.remove`, `profile.get`, `profile.setName`, `profile.setLocale` rejects `{ code: "FORBIDDEN", message: "errors.guestNotAllowed" }` (use `rejection()` from `support.ts`).
  - `guest can still play`: a guest joins a member's open match, calls `maze.conceptForMatch`, `maze.get`, `maze.saveDraft` (the gated draft), `match.eligibleMazes`, `match.submitMaze`. Each succeeds.
  - `match.list hides a guest's finished matches`: after a guest's match is `complete` (or `abandoned` via `sweepAll`), the guest's `match.list` is `[]`. A member's list still includes the match.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Swap those procedures to `memberProcedure`, and filter `list` on `ctx.session.user.isAnonymous`. `discardIfEmpty`, `get`, `saveDraft` and `conceptForMatch` stay `protectedProcedure`.
- [ ] **Step 4:** Pass; `pnpm test:integration` (whole suite) still green.
- [ ] **Step 5: Commit** — `feat: refuse guests outside their own match`.

### Task 3: The lobby without a session

**Files:**
- Modify: `src/server/api/routers/match.ts` (`waitingMatches`, `lobby`, `preview`)
- Test: `tests/integration/match-lobby.test.ts`

**Interfaces:**
- Produces: `waitingMatches(db, callerId: string | null, now, opts)`. With `null`, the request join is skipped and every `request` is `"none"`. `lobby` → `{ you: string | null; matches }`. `preview` → `isYours: false` for a visitor. Both are `publicProcedure`.

- [ ] **Step 1: Write failing tests:** a caller built from `createTRPCContext({ headers: new Headers() })` gets the lobby (`you: null`, a member's open match listed with `request: "none"`) and a preview of a locked match. `match.join` from the same caller is still `UNAUTHORIZED`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement as in Interfaces. Neither procedure gains a maze column (invariant 1).
- [ ] **Step 4:** Pass.
- [ ] **Step 5: Commit** — `feat: lobby and preview readable without a session`.

### Task 4: Guest names

**Files:**
- Modify: `src/server/api/routers/match.ts` (`waitingMatches` creator, `get` opponent, `requests`), `src/server/api/routers/run.ts` (the names read near line 108), the components that render those names (find with `git grep -n "displayName\|creatorName\|\.name\b" src/components`), `messages/*.json`
- Create: `src/components/player-name.ts` exporting `usePlayerName()`
- Test: `tests/integration/guest.test.ts`

**Interfaces:**
- Produces:
  - Every server name read returns `guest: boolean` beside the name: `opponent: { displayName, guest, … }`, request rows `{ name, guest, … }`, run names `{ id, name, guest }`, lobby `creatorGuest`.
  - `usePlayerName(): (p: { name: string; guest: boolean }) => string`, which returns `t("players.guestName", { number: name })` for a guest and `name` otherwise. Every place that shows another player's name goes through it.

- [ ] **Step 1: Write failing test:** a member's `match.get` after a guest joins has `opponent.guest === true` and `opponent.displayName` equal to the guest's number. The member's `match.requests` on a locked match shows the guest the same way.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement; select `user.isAnonymous` alongside `user.name`. Add `players.guestName` to both catalogues.
- [ ] **Step 4:** Pass; `pnpm test` (catalogue parity) and `pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat: show guests as "Guest 4821"`.

### Task 5: What a guest leaves behind

**Files:**
- Modify: `src/server/api/routers/match.ts` (`submitMaze`), `src/app/api/cron/sweep/route.ts`
- Create: `src/server/guest/purge.ts`
- Test: `tests/integration/guest.test.ts`, `tests/integration/purge.test.ts`

**Interfaces:**
- Produces: `purgeIdleGuests(db, now: Date): Promise<{ purged: number; capped: boolean }>`. Batch 100, like `purgeDeletedMazes`. It deletes `user` rows with `isAnonymous`, `createdAt <= now - 30 days`, and no `match_player` row. The cron response gains `guests: { purged, capped }`.

- [ ] **Step 1: Write failing tests:**
  - `a guest's submitted maze is marked deleted`: after `submitMaze`, the maze row has `deletedAt` equal to the player's `submittedAt` (same `now`). The opponent's `run.result` still includes its drawing once the match ends.
  - In `purge.test.ts`: `purgeDeletedMazes` removes a guest's maze once the match ended 30 days ago. The match's `match_player` rows both remain, and the guest's `mazeId` is null.
  - `purgeIdleGuests`: deletes a 31-day-old guest with no seat (age it by updating `createdAt`). Keeps a 31-day-old guest with a seat, a 29-day-old guest with no seat, and a 31-day-old member with no seat.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** In `submitMaze`, set `deletedAt: now` in the same update that marks the maze submitted, only when `ctx.session.user.isAnonymous`. Write `purgeIdleGuests` and call it from the cron route after `purgeDeletedMazes`.
- [ ] **Step 4:** Pass, including `tests/integration/cron-sweep.test.ts`.
- [ ] **Step 5: Commit** — `feat: a guest's maze and idle guests expire`.

### Task 6: Signing up keeps the game

**Files:**
- Create: `src/server/guest/link.ts`
- Modify: the `betterAuth` config (`onLinkAccount`)
- Test: `tests/integration/guest-link.test.ts`

**Interfaces:**
- Produces: `linkGuest(db, { guestId: string; accountId: string }): Promise<{ keepGuest: boolean }>`. It runs in one transaction and takes `lockAuthor` on the account first. The hook calls it, then deletes the guest `user` row unless `keepGuest`.

The rules `linkGuest` applies:

- **Matches:** a "colliding match" is one where the account already has a `match_player` row. For every other match the guest sits in, move `match_player.user_id`, `move.runner_id` and `match.winner_id` to the account.
- **Requests:** move each `match_request` whose match the account has no request or seat in. Delete the rest.
- **Mazes:** move every guest maze except the ones a colliding match uses. Clear `deletedAt` on each moved maze with `status = 'submitted'`.
- **The concept:**
  - If the account has none, the guest's concept moves over.
  - If both have one and the guest has an unsubmitted seat in a `drawing` match that moved, the account's concept becomes a saved labyrinth (`concept = false`, kept as it is, not refused for the limit) and the guest's moves over.
  - Otherwise the guest's concept is deleted.
- **`keepGuest`** is `true` exactly when a colliding match exists.

- [ ] **Step 1: Write failing tests** (sign up through `auth.api.signUpEmail` with the guest's cookie in `headers`; sign in through `auth.api.signInEmail` likewise):
  - `sign-up moves a running match`: a guest mid-run signs up. The guest user is gone. The new account's `run.get` equals the guest's last `run.get`, and the next `run.move` succeeds.
  - `sign-up keeps a submitted maze`: the guest maze is the account's, `deletedAt` is null, and `maze.list` shows it as used. Its `deletedAt` stays null after `purgeDeletedMazes` 31 days past the end.
  - `sign-up moves a pending request` on a locked match.
  - `sign-in to an account already in the same match keeps the guest`: the member signs in from the guest session of their own opponent. The match is unchanged and the guest user still exists.
  - `concept collision while drawing`: the account's concept becomes a saved labyrinth and the guest's concept is now the account's.
  - `a wrong password links nothing`: `signInEmail` rejects, and the guest user and seat are unchanged.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `linkGuest` and wire `onLinkAccount`. The plugin calls the hook after the new session exists. A thrown error must surface, not be swallowed, so a failed link is visible in the logs.
- [ ] **Step 4:** Pass; whole integration suite green.
- [ ] **Step 5: Commit** — `feat: carry a guest's match over when they sign up`.

### Task 7: Pages for visitors and guests

**Files:**
- Move: `src/app/[locale]/(app)/matches/page.tsx` and `src/app/[locale]/(app)/labyrinths/page.tsx` into a new unguarded group `src/app/[locale]/(open)/` (same URLs; `matches/[id]` and `labyrinths/[id]` stay in `(app)`).
- Create: `src/components/viewer.ts` (`useViewer()`), `src/components/sign-up-notice.tsx`
- Modify: `src/app/[locale]/(join)/matches/[id]/join/page.tsx`, `src/app/[locale]/(auth)/layout.tsx`, `src/app/[locale]/(app)/profile/page.tsx`, `src/app/[locale]/(app)/labyrinths/[id]/page.tsx`, `src/app/[locale]/page.tsx`, `src/components/site-header.tsx`, `src/components/site-menu.tsx`, `src/components/home-summary.tsx`, `src/components/match/lobby-action.tsx`, `src/components/match/lobby-list.tsx`, `src/components/match/join-preview.tsx`, `src/components/match/match-list.tsx`, `messages/*.json`

**Interfaces:**
- Consumes: `viewer.get`, `signIn.anonymous`, the `lobby`/`preview` shapes (Tasks 1–3).
- Produces:
  - `useViewer(): { viewer: Viewer | undefined; isPending: boolean }`, wrapping `api.viewer.get.useQuery`.
  - `<SignUpNotice kind="matches" | "labyrinths" />`: one sentence saying an account is needed to create matches and labyrinths, plus Sign up and Sign in links carrying `next` back to the current page. Copy keys under `guest.*`.

- [ ] **Step 1: Make the changes.** For each surface:
  - **`/matches`:**
    - `CurrentMatch` for guests and members.
    - `<SignUpNotice kind="matches" />` in place of `NewMatchForm` for visitors and guests.
    - `LobbyList` for all.
    - `MatchList` for members only.
    - `useActiveMatch`'s `match.list` query is `enabled` only with a session.
  - **`/labyrinths`:** `<SignUpNotice kind="labyrinths" />` for visitors and guests. Members see the list as now.
  - **`LobbyAction`:**
    - For a visitor, the labels are `guest.joinAsGuest` / `guest.requestAsGuest`, and the click runs `signIn.anonymous()` before the existing mutation.
    - For a guest, the click goes straight to the mutation.
    - After a sign-in, invalidate `viewer.get` and `router.refresh()` so the header updates.
    - A visitor also gets a Sign in link (`next` = this page).
  - **`LobbyList` / `JoinPreview`:**
    - Subscribe to the lobby channel and the user channel only with a session (`useChannel(null, …)` otherwise). A visitor relies on the existing `refetchInterval: POLL_MS`.
    - `JoinPreview` takes `userId: string | null`.
  - **Join page:** no sign-in redirect. A visitor gets the preview (Task 3 makes `preview` public). The participant redirect still runs only with a session.
  - **`(auth)` layout:** redirect only a non-anonymous session.
  - **`/profile`:** a guest is redirected to `/sign-up`. The server page asks `api.viewer.get()`.
  - **`/labyrinths/[id]`:** for a guest, render the editor only when the row is a concept and `forMatch` resolves. Otherwise render `<SignUpNotice kind="labyrinths" />`.
  - **Header and menu:**
    - A guest sees their guest name plus Sign in / Sign up, and the Matches link but not Labyrinths.
    - No profile or sign-out in the menu: a guest who signs out loses their game.
    - The header reads `session.user.isAnonymous`; layouts and the header are exempt from invariant 11.
  - **Home:**
    - A visitor sees Sign up, Sign in and a link to `/matches`.
    - A guest sees the same plus `CurrentMatch`.
    - `HomeSummary` stays for members only.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 3:** Update `e2e/protected.spec.ts`, which expects `/matches` and `/labyrinths` to redirect a visitor; they now render. Run `pnpm e2e e2e/protected.spec.ts e2e/navigation.spec.ts e2e/lobby.spec.ts e2e/home.spec.ts`. Expected: PASS.
- [ ] **Step 4: Commit** — `feat: matches and labyrinths pages for visitors and guests`.

### Task 8: End to end

**Files:**
- Create: `e2e/guest.spec.ts`; add a `joinAsGuest(page, matchId)` helper to `e2e/support/match.ts` if it simplifies the spec.

- [ ] **Step 1: Write the specs:**
  - `a visitor plays a whole match as a guest`: a member creates an open match and sends the share link. A fresh context opens it, clicks "Join as guest", draws (reuse the existing draw helpers) and submits. Both run to the result, with the review boards visible on both sides. The member's result names the opponent `Guest NNNN`.
  - `a visitor's matches page`: the sign-up notice is shown, no new-match form, no "Your matches" heading. No console errors; `page.on("console")` collects errors, and the expected count is 0.
  - `a guest's labyrinths page shows only the notice`.
  - `signing up from the result keeps the match`: the guest clicks Sign up in the header and signs up. On `/matches` the match is listed under "Your matches", and on `/labyrinths` the maze is listed as used.
  - `a second join after a failed one does not sign in again`: a visitor joins a match that has just been filled (seat a member in it first via the API) and sees the error. They then join another open match and land on it.
- [ ] **Step 2:** `pnpm e2e e2e/guest.spec.ts` — PASS on desktop and mobile projects.
- [ ] **Step 3:** Full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration && pnpm e2e`.
- [ ] **Step 4: Commit** — `test: guest play end to end`.
