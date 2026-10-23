# Match Lobby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace join-by-code with a live public lobby. Matches are open (join at once) or locked (request → the creator accepts). Locked matches get a share link. Each player may host one waiting match.

**Architecture:** One new column (`match.access`) and one new table (`match_request`). New tRPC procedures in the match router share one `seatOpponent` helper. Two new payload-free realtime channels (`private-lobby`, `private-user_<id>`) go through the existing `canSubscribe`. New UI: the lobby list on `/matches`, a requests panel and share button on the waiting screen, and a `/matches/[id]/join` page reachable signed-out through a `?next=` return path.

**Tech Stack:** Next.js App Router, tRPC, Drizzle (neon-serverless Pool), Better Auth, next-intl, Pusher / local SSE bus, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-match-lobby-design.md`. Read it first; this plan does not repeat its reasoning.

## Global Constraints

- AGENTS.md invariants hold. In particular: no lobby/preview/request procedure reads `maze` (1); `src/match/` and `src/lib/` stay framework-free (2); errors are message keys (3); every string in both `en.json` and `sk.json` (9); colours from tokens (10); components never import the db (11); every subscription is decided by `canSubscribe`, and publishing happens after commit through `publishSafely` (12).
- Use pnpm. Never run `vercel env pull`.
- `match.access` enum is exactly `'open' | 'locked'`, default `'open'`.
- New error keys, exactly: `errors.alreadyWaiting`, `errors.matchLocked`, `errors.matchNotLocked`, `errors.requestDeclined`, `errors.requestGone`, `errors.matchNotFound`. Removed: `errors.matchCodeUnknown`, `errors.matchCodeMalformed`.
- Channel names, exactly: `private-lobby` and `private-user_<userId>`. Event: the existing `EVENTS.changed`, payload `{}`.
- `match.code` stays as a label. It is no longer accepted as join input.
- Requesters are never in `match_player`.
- Every write that touches a match's requests or seating takes `FOR UPDATE` on the `match` row first.

## Review Focus

1. **A requester trying to subscribe to the match's channels.** They must be refused, since they are not a participant. Test it in Task 6.
2. **A match that expired but has not been swept yet, in every view.** It must be absent from the lobby, `preview` must be `NOT_FOUND`, join must say `matchExpired`, and it must not block `create`. Tests in Tasks 3 and 4.
3. **A crafted `next` (`//evil.example`, `https://…`, `/\evil`).** It is ignored, and the user lands on `/`. Test it in Task 1.
4. **The creator opening their own share link.** They are a participant, so they are redirected to `/matches/<id>`, never offered "Request to join". Test it in Task 9 (e2e).
5. **A requester whose locked match is cancelled, or filled by someone else.** Their lobby row disappears live, and the join page shows "no longer open". Test it in Task 5 (the user channel ping) and Task 9 (e2e).

Branch: continue on the current branch (`ux-batch`), which already holds the library work this builds on (`match.endedAt`).

---

### Task 1: Pure pieces — channels, access enum, `safeNext`

**Files:**
- Modify: `src/match/channels.ts`, `src/match/status.ts` (or a new `src/match/access.ts` re-exported from `src/match/index.ts`), `src/match/code.ts`
- Create: `src/lib/safe-next.ts`
- Test: `tests/unit/match/channels.test.ts`, `tests/unit/match/code.test.ts`, `tests/unit/safe-next.test.ts`

**Interfaces:**
- Produces:
  - `MATCH_ACCESS = ["open", "locked"] as const`, `type MatchAccess`.
  - `lobbyChannel(): "private-lobby"` and `userChannel(userId: string): string`.
  - `ParsedChannel` gains `{ kind: "lobby" }` and `{ kind: "user"; userId: string }`.
  - `safeNext(value: string | null | undefined): string | null`.
  - `matchCodeSchema` is deleted. `makeCode`, `CODE_ALPHABET` and `CODE_LENGTH` stay.

- [ ] **Step 1: Write failing tests.**
  - Channels:
    - `parseChannel(lobbyChannel())` → `{ kind: "lobby" }`.
    - `parseChannel(userChannel("abc"))` → `{ kind: "user", userId: "abc" }`.
    - `parseChannel("private-user_")`, `parseChannel("private-user_a_b")` and `parseChannel("private-lobbyx")` → `null`.
    - `isPresenceChannel` is false for both new channels.
  - `safeNext`:
    - `"/matches/x/join"` → itself.
    - `null`, `""`, `"matches"`, `"//evil.example"`, `"/\\evil"`, `"https://evil.example"`, `"/%2F%2Fevil"` → `null`. Reject anything whose decoded form starts with `//` or `/\`.
  - Remove the `matchCodeSchema` cases from `code.test.ts`.
- [ ] **Step 2:** Run `pnpm test`. The new cases fail.
- [ ] **Step 3: Implement.** Use the `private-user_` prefix with the same "no `_` inside the id" rule as `MATCH_PREFIX`. Delete `matchCodeSchema` and its export.
- [ ] **Step 4:** Run `pnpm test`, `pnpm typecheck` and `pnpm lint`. Unit tests pass. Typecheck fails only in `routers/match.ts`, on the join input, which Task 3 fixes. Note this, and don't work around it.
- [ ] **Step 5:** Commit: `feat: lobby and user channels, match access enum, safeNext`.

### Task 2: Schema and migration

**Files:**
- Modify: `src/server/db/schema/match.ts`
- Create: `drizzle/0008_*.sql` (generated, then hand-edited)
- Test: `tests/integration/match-schema.test.ts`

**Interfaces:**
- Consumes: `MATCH_ACCESS`.
- Produces:
  - `match.access` (not null, default `'open'`).
  - `matchRequest` table: `matchId` FK cascade, `userId` FK cascade, `createdAt` default now, `declinedAt` nullable, PK `(matchId, userId)`, plus an index on `userId`.
  - Partial unique index `match_one_waiting_per_creator` on `match(created_by_id) WHERE status = 'awaiting_opponent'`.

- [ ] **Step 1: Write failing integration tests.**
  - `match_one_waiting_per_creator`: insert two `awaiting_opponent` rows for one creator directly → the second rejects. A second row with status `drawing` is accepted.
  - `match_request`: deleting the match deletes its requests. A duplicate `(matchId, userId)` rejects.
- [ ] **Step 2:** Run `pnpm test:integration -- match-schema`. Expected: FAIL.
- [ ] **Step 3: Schema and migration.** Add the schema, then run `pnpm db:generate`. Before the `CREATE UNIQUE INDEX`, prepend a data step that sets `status='abandoned', end_reason='abandoned', winner_id=NULL, ended_at=now(), last_activity_at=now()` on every `awaiting_opponent` match except the newest per `created_by_id`. There are no real players yet (spec, "Left to the builder"), so this needs no other care.
- [ ] **Step 4:** Run `pnpm db:migrate`, then `pnpm test:integration -- match-schema`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: match access, match_request, one waiting match per creator`.

### Task 3: `seatOpponent`, join by id, `create` with access and the one-waiting rule

**Files:**
- Create: `src/server/match/seat.ts`
- Modify:
  - `src/server/api/routers/match.ts` (`create`, `join`)
  - `src/server/realtime/events.ts`
  - `messages/en.json`, `messages/sk.json` (error keys only)
- Test: `tests/integration/match-router.test.ts`

**Interfaces:**
- Produces:
  - `seatOpponent(tx: DbClient, row: MatchRow, players: PlayerRow[], userId: string, now: Date): Promise<void>`. It inserts the player row, sets `drawing` and `lastActivityAt`, and recomputes `deadlineAt` exactly as today's `join` does.
  - `publishLobbyChanged(): Promise<void>` and `publishUserChanged(userId: string): Promise<void>` in `events.ts`.
  - `match.create` input: `settingsInput.extend({ access: z.enum(MATCH_ACCESS).default("open") })`. Returns `{ id, code }` as before.
  - `match.join` input: `{ matchId: z.string() }`.

- [ ] **Step 1: Write failing tests.** Rewrite the existing join-by-code tests to join by `matchId`, and keep their assertions. Add:
  - Joining a locked match → `CONFLICT` / `errors.matchLocked`.
  - Joining an unknown id → `NOT_FOUND` / `errors.matchNotFound`.
  - A second `create` while one is waiting → `CONFLICT` / `errors.alreadyWaiting`.
  - `create` while the caller's waiting match is past its deadline: the old match becomes `abandoned`, and the new one is created.
  - `create` after the first match moved to `drawing` succeeds.
  - `create({ ...settings, access: "locked" })` stores `locked`.
- [ ] **Step 2:** Run `pnpm test:integration -- match-router`. Expected: FAIL.
- [ ] **Step 3: Implement `create`.** Before the code-retry loop, select the caller's `awaiting_opponent` match.
  - If its `deadlineAt <= now`, call `closeIfExpired(ctx.db, id, now)` (it opens its own transaction).
  - Otherwise, throw `alreadyWaiting`.
  - Inside the insert's `catch`, map a violation of `match_one_waiting_per_creator` to `alreadyWaiting`, next to the existing `match_code` check.
  - After commit, call `publishLobbyChanged()`.
- [ ] **Step 4: Implement `join`.** Look up by id `FOR UPDATE`. A missing row is `matchNotFound`. Keep the existing checks, in this order: `alreadyInMatch`, `matchFull`, `matchExpired`. Then `access === "locked"` → `matchLocked`. Then `seatOpponent`. After commit: `publishMatchChanged(id)` and `publishLobbyChanged()`.
- [ ] **Step 5: Update the catalogues.** Add the six new error keys to both catalogues and delete the two removed ones. Then run `pnpm test`, `pnpm typecheck` and `pnpm test:integration -- match-router`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: join by match id, open/locked access, one waiting match per creator`.

### Task 4: `lobby` and `preview` queries

**Files:**
- Modify: `src/server/api/routers/match.ts`
- Test: `tests/integration/match-lobby.test.ts` (new)

**Interfaces:**
- Produces:
  - `type LobbyItem = { id: string; creatorName: string; cellCount: number; gateCount: number; access: MatchAccess; createdAt: Date; deadlineAt: Date; request: "none" | "pending" | "declined" }`.
  - `match.lobby(): { you: string; matches: LobbyItem[] }`: `you` is the caller's user id (for subscribing to their user channel), and `matches` is newest first.
  - `match.preview({ matchId }): LobbyItem & { isYours: boolean }`, or `NOT_FOUND` / `errors.matchNotFound`.
  - `match.get` gains `access` and `isCreator: boolean`.

- [ ] **Step 1: Write failing tests.**
  - The lobby contains a fresh open match and a fresh locked match from others, and not:
    - the caller's own match
    - a `drawing` match
    - a match whose `deadlineAt` was set into the past directly in the db, without sweeping
  - `request` reads `pending` after `requestJoin` and `declined` after a decline. Write these two cases now, marked `.todo`, and enable them in Task 5.
  - `preview` → `NOT_FOUND` for an unknown id, an expired match and a drawing match, all with the same message. For the creator's own waiting match, it succeeds with `isYours: true`.
  - The returned object contains no `code` key.
- [ ] **Step 2:** Run `pnpm test:integration -- match-lobby`. Expected: FAIL.
- [ ] **Step 3: Implement.** One query joins `match` → `user` (creator name), left-joined to `match_request` for the caller. Filter `status = 'awaiting_opponent' AND deadline_at > now`, and for `lobby` also `created_by_id <> caller`. `preview` reuses the same select.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: lobby and preview queries`.

### Task 5: Requests — request, withdraw, list, accept, decline; cancel and sweep pings

**Files:**
- Modify:
  - `src/server/api/routers/match.ts`
  - `src/server/match/sweep.ts`
  - `src/server/realtime/events.ts` (no new exports expected)
- Test: `tests/integration/match-requests.test.ts` (new), `tests/integration/sweep.test.ts`

**Interfaces:**
- Consumes: `seatOpponent`, `publishLobbyChanged`, `publishUserChanged`, `publishMatchChanged`.
- Produces: the procedures `match.requestJoin`, `match.withdrawRequest`, `match.requests` (returns `{ userId, name, createdAt }[]`, oldest first), `match.acceptRequest`, `match.declineRequest`, with the inputs and errors in the spec's procedure table.

- [ ] **Step 1: Write failing tests.** Every case in the spec's integration list under requests:
  - request → accept: the requester is seated, the status is `drawing`, and no `match_request` rows are left for the match.
  - After a decline, `requestJoin` → `errors.requestDeclined`.
  - Withdraw, then `requestJoin` → succeeds.
  - Requesting twice while pending is a no-op.
  - `requestJoin` on an open match → `errors.matchNotLocked`. By the creator → `errors.alreadyInMatch`.
  - A non-creator calling `requests`, `acceptRequest` or `declineRequest` → `FORBIDDEN` / `errors.notYourMatch` (same as `get`).
  - `acceptRequest` after a withdraw → `errors.requestGone`.
  - Two `acceptRequest` calls for two different requesters, run with `Promise.allSettled`: exactly one fulfilled, and the match has exactly 2 players.
  - `cancel` with pending requests → the rows are gone.
  - Publishing: spy on `publishSafely` the way `realtime-publish.test.ts` does. Assert:
    - `acceptRequest` pings `userChannel` for every requester, plus the match and lobby channels.
    - `requestJoin` pings the match channel.
    - `declineRequest` pings the requester's user channel.
  - Sweep: abandoning a waiting locked match with a pending requester pings `lobbyChannel()` and that requester's `userChannel`.
  - Enable the two `.todo` cases from Task 4.
- [ ] **Step 2:** Run the new test files. Expected: FAIL.
- [ ] **Step 3: Implement.** Every mutation:
  - Locks the match row `FOR UPDATE` first.
  - Checks `status = 'awaiting_opponent' AND deadlineAt > now`, else `matchExpired`. `acceptRequest` uses `requestGone` when the row has vanished.
  - Collects the user ids to ping inside the transaction and publishes after commit.

  `cancel` reads the pending requesters before its delete and pings them and the lobby after commit. In `sweepExpiredMatches`, after closing, select the `match_request` user ids for the closed ids. Publish the lobby once if any closed match had been `awaiting_opponent` (tell this from `due`), plus each requester's user channel.
- [ ] **Step 4:** Run `pnpm test:integration`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: join requests for locked matches`.

### Task 6: Subscriptions for the new channels

**Files:**
- Modify: `src/server/realtime/access.ts`
- Test: `tests/integration/realtime-routes.test.ts`

**Interfaces:**
- Consumes: the `ParsedChannel` kinds from Task 1.

- [ ] **Step 1: Write failing tests.**
  - `canSubscribe(db, anyUser, "private-lobby")` → true.
  - `canSubscribe(db, a, userChannel(a))` → true, and `canSubscribe(db, a, userChannel(b))` → false.
  - A user with a pending request on a match → false for that match's `matchChannel` and for both `runChannel`s.
- [ ] **Step 2:** Run the tests. Expected: FAIL on the lobby and user cases.
- [ ] **Step 3: Implement.** In `canSubscribe`, after `parseChannel`, handle `lobby` and `user` before calling `participantRows`. `maySubscribe` keeps its match-only contract.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `pnpm test:smoke` if `PUSHER_*` is set in the shell.
- [ ] **Step 5:** Commit: `feat: lobby and user channels pass through canSubscribe`.

### Task 7: Return after sign-in

**Files:**
- Modify: `src/components/auth-form.tsx`
- Create: `src/app/[locale]/(join)/matches/[id]/join/page.tsx`. This is a route group outside `(app)`, so this page does its own session check and can build `next`. `(app)/layout.tsx` cannot see the pathname, so it stays as it is.
- Test: covered in Task 9 (e2e). Unit coverage of `safeNext` is in Task 1.

**Interfaces:**
- Consumes: `safeNext`.
- Produces: `/sign-in?next=<locale-less path>` and `/sign-up?next=…`.

- [ ] **Step 1: Read `next`.** In `AuthForm`, read `next` with `useSearchParams()`, pass it through `safeNext`, and use the result in place of `"/"` on every success path. `router.replace(next, { locale: stored })` already re-prefixes the locale. Carry `?next=` across the sign-in ↔ sign-up link.
- [ ] **Step 2: Session check.** The join page file in this task holds only the check for now: no session → `redirect({ href: { pathname: "/sign-in", query: { next: `/matches/${id}/join` } }, locale })`. Task 8 fills in the rest.
- [ ] **Step 3:** Run `pnpm typecheck` and `pnpm lint`, then check by hand with `pnpm dev`: signed out, open `/en/matches/<any>/join`, sign in, and you return to that path.
- [ ] **Step 4:** Commit: `feat: sign-in returns to the page that sent you`.

### Task 8: UI — lobby list, new-match access choice, waiting screen, join page

**Files:**
- Create:
  - `src/components/match/lobby-list.tsx`
  - `src/components/match/lobby-action.tsx` (the Join / Request / Withdraw / Declined button, shared by the lobby row and the join page)
  - `src/components/match/join-requests.tsx`
  - `src/components/match/share-match.tsx`
  - `src/components/match/join-preview.tsx`
- Modify:
  - `src/app/[locale]/(app)/matches/page.tsx`
  - `src/components/match/new-match-form.tsx`
  - `src/components/match/match-list.tsx`
  - `src/components/match/match-lobby.tsx`
  - `src/components/match/maze-picker.tsx` (only if its `match` prop type changes)
  - The join page from Task 7
  - `messages/en.json`, `messages/sk.json`
- Delete: `src/components/match/join-match-form.tsx`

**Interfaces:**
- Consumes: `match.lobby`, `match.preview`, `match.get` (`access`, `isCreator`), `match.requests`, the request mutations, `lobbyChannel`, `userChannel`, `useChannel`, `POLL_MS`.
- Produces: the DOM hooks that the e2e tests in Task 9 use:
  - `data-lobby-match={id}` on each lobby row
  - `data-request-state` on the action button
  - `data-join-request={userId}` on each request row
  - `data-share-match` on the share button

- [ ] **Step 1: `/matches`.** Order: `NewMatchForm`, `LobbyList`, `MatchList`. `JoinMatchForm` is removed.
  - `NewMatchForm` gains an Open / Locked radio group with a one-line hint per option.
  - When `match.list` contains a match of yours that is `awaiting_opponent` with a future `deadlineAt`, the form is replaced by a note linking to it.
  - `MatchList` drops the "Share this code" line and `data-match-code`.
- [ ] **Step 2: `LobbyList`.**
  - Read `match.lobby`.
  - Subscribe to `lobbyChannel()` and to the caller's `userChannel`, and invalidate `match.lobby` on `changed` and on catch-up. Poll at `POLL_MS`.
  - Rows show: creator, size, gates, relative age (`useFormatter().relativeTime`), and for locked matches a lock icon plus a text label.
  - Empty state as in the spec.
  - Take the user channel's id from `lobby.you`.
- [ ] **Step 3: `LobbyAction`.**
  - Open → `join` → push `/matches/<id>`.
  - Locked:
    - `none` → `requestJoin`
    - `pending` → "Requested" + Withdraw
    - `declined` → disabled "Declined"
  - Errors render through `resolveErrorKey`.
- [ ] **Step 4: Waiting screen (`match-lobby.tsx`)** when `awaiting_opponent`:
  - Replace the share-code paragraph with:
    - open: "your match is in the lobby"
    - locked and `isCreator`: `<ShareMatch>` and `<JoinRequests>`
  - `JoinRequests` reads `match.requests` and refetches on the match channel ping. `MatchScreen` already subscribes to that channel, so invalidate `match.requests` there; don't subscribe twice (see the `useChannel` doc comment).
  - The Accept and Decline buttons call the mutations.
- [ ] **Step 5: `ShareMatch`.**
  - URL: ``${location.origin}/${locale}/matches/${id}/join``.
  - Call `navigator.share({ title, text, url })` when `typeof navigator.share === "function"`. Ignore `AbortError`. Otherwise, call `navigator.clipboard.writeText(url)` and show `lobby.linkCopied` for a few seconds in a `role="status"` element.
- [ ] **Step 6: Join page.**
  - Signed in: call `api.match.get({ id })`; if it succeeds (a participant), `redirect` to `/matches/<id>`.
  - Else call `api.match.preview`: `NOT_FOUND` → "This match is no longer open" with a link to `/matches`. Otherwise render `<JoinPreview>`: the details plus `LobbyAction`, with a subscription to the user channel. On `changed`, it refetches `match.get`; if that now succeeds, it pushes `/matches/<id>`.
- [ ] **Step 7: Strings.** Add all new strings to both catalogues, in the namespaces `matches` and `lobby`. Remove the now-unused `matches.code`, `matches.codeHint`, `matches.joinHeading` and `matches.shareCode`. Update `matches.empty` so it no longer mentions codes.
- [ ] **Step 8:** Run `pnpm test` (catalogue parity), `pnpm typecheck` and `pnpm lint`. Then run `pnpm dev` with two browsers and try both flows by hand.
- [ ] **Step 9:** Commit: `feat: lobby UI, locked-match requests, share link and join page`.

### Task 9: End-to-end tests

**Files:**
- Modify:
  - `e2e/support/match.ts`
  - `e2e/support/run.ts`
  - `e2e/lobby.spec.ts`
  - `e2e/match.spec.ts`
  - `e2e/labyrinths.spec.ts`
  - `e2e/watch.spec.ts`
- Create: `e2e/matchmaking.spec.ts`

**Interfaces:**
- Produces:
  - `createMatch(page, { cells, gates, access?: "open" | "locked" }): Promise<string>` now returns the **match id**, read from the URL.
  - `joinMatch(guest: Page, matchId: string): Promise<void>` opens `/en/matches/<id>/join`, clicks Join, and waits for `/en/matches/<id>`.

- [ ] **Step 1: Migrate the existing helpers and specs.** Replace every "Join code" fill with `joinMatch`. Where a spec used the code as a label, read it from the waiting screen or the editor instead. In `lobby.spec.ts` the label assertions use `Labyrinth for match ${code}`: get the code from `match.get` via a `data-match-code` attribute on the editor link, or assert with a regex. Your choice; keep the assertion's intent.
- [ ] **Step 2: Write `matchmaking.spec.ts`.**
  - Open match: the host creates it. Without reloading, the guest's `/en/matches` shows `[data-lobby-match=<id>]`. The guest clicks Join, and both reach drawing.
  - Locked match:
    - The guest clicks "Request to join".
    - The host's waiting screen shows `[data-join-request]` live. The host clicks Accept.
    - The guest is navigated into the match.
  - Decline: the guest's button reads "Declined" and is disabled.
  - Share link, signed out: open `/en/matches/<id>/join` in a fresh context. It goes to sign-in; after signing in, the guest is back on the join page with "Request to join".
  - Clipboard fallback: in desktop Chromium, grant `clipboard-read`/`clipboard-write`, remove `navigator.share` via `addInitScript`, click `[data-share-match]`, and the clipboard holds the join URL.
  - The creator opens their own share link and is redirected to `/en/matches/<id>`.
  - A second create while waiting shows the "already waiting" note rather than the form.
- [ ] **Step 3:** Run `pnpm e2e`. Expected: all projects pass.
- [ ] **Step 4:** Commit: `test: e2e for the lobby, requests and share links`.

### Task 10: Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-labyrinth-design.md`, `AGENTS.md`

- [ ] **Step 1: Main spec.** Apply the amendments listed in the lobby spec's "Spec amendments to make in the main design" section (§1, §6, §8, §9, §12, §16, §17), and link the lobby spec from each section you change.
- [ ] **Step 2: AGENTS.md.** In invariant 12, name the two new channel kinds and note that `canSubscribe` decides them without a participant check. In invariant 1, add that `lobby`, `preview` and `requests` read no maze columns.
- [ ] **Step 3:** Commit: `docs: fold the lobby into the main design and invariants`.
