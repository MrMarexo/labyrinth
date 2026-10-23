# Public match lobby, locked matches and share links

Date: 2026-10-23. Amends the main design (`2026-09-22-labyrinth-design.md`,
§1, §6, §8, §9, §12, §16, §17) where noted.

## Why

Today a player finds a match only by being told its six-character code and
typing it in. That works between friends and nowhere else: there is no way to
see who is waiting for an opponent. The owner wants a lobby: one list of every
match waiting for an opponent, which anyone signed in can join from.

Some players still want to choose their opponent. For them there are **locked**
matches: listed in the lobby like any other, but joining one only sends a
request, and the creator decides whom to accept. A locked match also gets a
**share button**, so the creator can send its link to a friend through the
phone's share sheet (Messages, WhatsApp, …) instead of reading out a code.

## Goals

1. `/matches` shows a live lobby: every match in `awaiting_opponent`, before
   its deadline, created by someone else.
2. Joining an **open** match from the lobby seats you immediately, as joining
   by code does today.
3. Joining a **locked** match sends a request. The creator sees pending
   requests on the match's waiting screen and accepts one or declines any. If
   one is accepted, that player is seated and the match moves to `drawing`.
4. A locked match's waiting screen has a **Share** button that shares a link to
   the match through the device's share sheet. Where there isn't one, it
   copies the link.
5. A shared link opens a join page for that match. Signing in first, if
   needed, brings you back to it.
6. A player can have **at most one match waiting for an opponent** that they
   created.

## Non-goals

- Random or automatic matchmaking. The player always picks a match.
- Filtering or sorting the lobby. It is newest first. A lobby limited to one
  waiting match per player stays short enough for now.
- A share button on open matches (the owner asked for it on locked ones).
- Watching other people's matches from the lobby. §8's rule that nobody
  outside a match can watch it stands.
- Any change to what happens after a match reaches `drawing`.

## Anti-goals

- **A lobby or join page that discloses anything about a maze.** At
  `awaiting_opponent` no maze has been submitted, and the lobby and join page
  read only `match` and `user` rows. AGENTS.md invariant 1 stands as it is.
- **A requester treated as a participant.** Someone who has only asked to
  join must not pass `participantRows`, must not subscribe to the match's
  channels, and must not be counted by any "two players" check.
- **Two ways to seat an opponent that can drift apart.** Open-join and
  accept-request seat a player through one function.

## Decisions

### Data model (amends §6)

- **`match.access`**: `text`, enum `'open' | 'locked'`, not null, default
  `'open'`. Chosen at creation, never changed afterwards.
- **New table `match_request`**: `matchId` (FK → `match`, cascade on delete),
  `userId` (FK → `user`, cascade on delete), `createdAt`, `declinedAt`
  (nullable). Primary key `(matchId, userId)`. One row per player per match:
  - pending = the row exists with `declinedAt` null
  - declined = `declinedAt` set. The row stays so that player cannot request
    the same match again.
  - withdrawn = the row is deleted, so the player may request again.
  - On accept, every request row for that match is deleted: the accepted
    player is now in `match_player`, and the others' requests have nothing
    left to ask for.

  Requests deliberately live outside `match_player`. A requester row there
  would pass `participantRows`, which would admit it to `canSubscribe`
  (invariant 12) and break every `players.length` check.
- **One waiting match per creator**: a partial unique index on
  `match(created_by_id) WHERE status = 'awaiting_opponent'`. `match.create`
  checks first and refuses with `errors.alreadyWaiting` (with a link to that
  match in the UI). The index is the guarantee and the check is the friendly
  message. A unique-violation that slips through is mapped to the same error.

  **An expired waiting match does not count.** The sweep runs once a day, so
  a match can sit in `awaiting_opponent` for up to a day after its deadline,
  hidden from the lobby but still matched by the index (which cannot include
  `now()`). `create` therefore first runs
  `closeIfExpired` on the caller's waiting match, if they have one, in its own
  transaction just before the create transaction (not inside it). That
  abandons the match exactly as the sweep would, so the old match is gone
  before the check and the index see it. Running it outside is harmless: the
  match is already expired, and the unique index plus the `alreadyWaiting`
  mapping still guard races. The `/matches` note and the
  "already waiting" check both test `status = 'awaiting_opponent' AND
  deadlineAt > now`. *(Builder-writer's call. The alternative, refusing for
  up to a day over a match nobody can join, works against the owner's
  intent.)*
- **`match.code` stays** as a short human-readable label for a match: the
  editor names a new draft "Labyrinth for match {code}", and matches are told
  apart in lists by it. It is no longer used to join. *(Builder-writer's call:
  dropping the column would touch the editor, the picker and their e2e for no
  gain.)*

No new match status. `awaiting_opponent` already means "in the lobby", and
§9's state machine, the deadlines in §9.1 and the sweep are unchanged. An
expired waiting match drops out of the lobby when its deadline passes, before
the sweep has run, because the lobby query filters on `deadlineAt > now`.

### Server procedures (`src/server/api/routers/match.ts`)

| Procedure | Caller | Behaviour |
|---|---|---|
| `create` | anyone | Gains `access`. Refused with `errors.alreadyWaiting` if the caller already has a waiting match. Publishes a lobby ping after commit. |
| `lobby` (query) | anyone | Matches in `awaiting_opponent`, `deadlineAt > now`, `createdById ≠ caller`, newest first. Each item: `id`, creator's display name, `cellCount`, `gateCount`, `access`, `createdAt`, `deadlineAt`, and the caller's request state for it (`none` / `pending` / `declined`). The caller's own waiting match is not listed: it shows under "Your matches". |
| `preview({ matchId })` (query) | anyone | What the join page shows: the same fields as one lobby item plus `isYours` / `isParticipant`. A match that does not exist, is not `awaiting_opponent`, or is past its deadline is `NOT_FOUND`, and these cases are indistinguishable from one another. Only waiting matches are visible to non-participants, and the lobby already shows all of those, so nothing new leaks. |
| `join({ matchId })` | anyone | Replaces join-by-code. Refused on a locked match with `errors.matchLocked`. Existing errors are kept: `alreadyInMatch`, `matchFull`, `matchExpired`. A match that does not exist is `errors.matchNotFound` (new key; `matchCodeUnknown` and `matchCodeMalformed` are removed). |
| `requestJoin({ matchId })` | anyone but the creator | Inserts a pending request. Refused if: the match is not locked (`errors.matchNotLocked`, so the client should have joined directly), it is not waiting or is past its deadline (`matchExpired`), the caller is the creator (`alreadyInMatch`), or the caller was declined (`errors.requestDeclined`). Requesting again while pending is a no-op. Pings the match channel (so the creator sees it) and the requester's user channel. |
| `withdrawRequest({ matchId })` | the requester | Deletes a pending request; a no-op if none. A declined row is not deleted by withdrawing. Pings the match channel. |
| `requests({ matchId })` (query) | the creator | Pending requests for their waiting locked match: `userId`, display name, `createdAt`, oldest first. `FORBIDDEN` (`errors.notYourMatch`) for anyone else, as `get` does. |
| `acceptRequest({ matchId, userId })` | the creator | Locks the match row `FOR UPDATE`, re-checks it is waiting and before its deadline, and checks the request exists and is pending (`errors.requestGone` otherwise: withdrawn, or the match was cancelled). Then: `seatOpponent`, delete all of the match's requests, commit. After commit, ping the match channel, the lobby, and the user channel of every player who had a request (accepted or not). |
| `declineRequest({ matchId, userId })` | the creator | Sets `declinedAt`. Pings the requester's user channel. |
| `cancel` | the creator | Unchanged, apart from also pinging the lobby and the user channels of anyone with a pending request (their rows go with the match through the cascade). |

**`seatOpponent(tx, row, players, userId, now)`**: the body of today's `join`
after its checks (insert the `match_player` row, set `drawing`, recompute
`deadlineAt` through `deadlineFor(situationFor(…))`), extracted into
`src/server/match/` and called by both `join` and `acceptRequest`.

**Race rules.** All of these come from the existing `FOR UPDATE` on the match
row, which `join`, `acceptRequest`, `cancel`, `requestJoin`,
`withdrawRequest` and `declineRequest` all take. Without it, a request
racing an accept could leave a pending row on a `drawing` match.
- Two players joining one open match: one is seated, the other gets
  `matchFull`.
- Accept vs. withdraw: whichever runs second either finds no request
  (`requestGone`) or finds no pending row to delete.
- Accept vs. cancel: the accept finds no row (`requestGone`), or the cancel
  finds a `drawing` match and is refused, as cancel vs. join behaves now.

**A waiting creator joining something else.** Hosting a waiting match does not
stop a player from joining or requesting other matches. When they are seated in
another match, their own waiting match stays listed. *(Builder-writer's call.
The owner's "one game per user" was the answer to "how many open games may one
player post", so it limits hosting, not playing.)*

**No cap on pending requests per player.** *(Builder-writer's call.)*

### Realtime (amends §8; AGENTS.md invariant 12)

Two new payload-free channels, each carrying only `changed`, after which the
client refetches through the procedures above:

- **`private-lobby`**: pinged on create, join, accept, cancel, and when the
  sweep abandons an `awaiting_opponent` match. Anyone signed in may subscribe.
  When the sweep abandons a waiting match, it also pings the user channels of
  that match's pending requesters.
- **`private-user_<userId>`**: pinged when the state of one of that user's
  requests changes (accepted, declined, the match was cancelled or filled by
  someone else). Only that user may subscribe.

`parseChannel` gains the `lobby` and `user` kinds. `canSubscribe` decides them
before its participant lookup: `lobby` → any signed-in user; `user` → its id
equals the caller's. Both transports already go through `canSubscribe`, so they
stay in agreement. The creator learns of new requests through the match channel
they already subscribe to. Publishing goes through `publishSafely` after
commit, as everything else does. Lobby, join page and request list also poll at
the existing `POLL_MS` as the fallback.

### Share link and join page

- **The link** is `/<locale>/matches/<id>/join`, absolute (origin included),
  in the creator's current locale.
- **The Share button** (locked waiting matches only, on the creator's waiting
  screen) calls `navigator.share({ title, text, url })` where it exists, which
  opens the phone's native share sheet. The `title` and `text` are i18n
  strings, e.g. "Join my Labyrinth match". Otherwise it copies the URL with
  `navigator.clipboard.writeText` and shows "Link copied". If the user
  dismisses the share sheet (`AbortError`), nothing happens.
- **The join page** `/matches/[id]/join`:
  - The caller is already a participant, in any status: redirect to
    `/matches/<id>`. This is checked before `preview`, which is `NOT_FOUND`
    for a match that has already left `awaiting_opponent`.
  - `preview` is `NOT_FOUND`: a "This match is no longer open" page with a
    link to the lobby.
  - Otherwise: the creator's name, size and gate count, and the same action
    button as the lobby row (Join / Request / Requested · Withdraw /
    Declined).
  - When the caller is seated (directly, or because an accept arrives on their
    user channel), it navigates to `/matches/<id>`.
- **Return after sign-in.** Today `(app)/layout.tsx` redirects a signed-out
  visitor to `/sign-in` and forgets where they were going. It must pass the
  path as `?next=…`, and sign-in and sign-up must send the user there on
  success, including the link between the two auth pages. `next` is accepted
  only if it is a same-site relative path (starts with `/`, not `//`), and is
  otherwise ignored. If sign-in switches to the account's saved locale, the
  `next` path's locale prefix is replaced with that locale, so the user lands
  on the join page in their own language.

  *As built:* `?next=` is set by the join page, which lives in its own route
  group `(join)` and does its own session check, because `(app)/layout.tsx`
  cannot see the request pathname. Other `(app)` pages still return to `/`
  after sign-in. Middleware setting an `x-pathname` header would let the
  layout do this for every `(app)` page; that is the future option.

### UI (amends §10)

- **`/matches`**, top to bottom:
  1. **New match** form: size, gates, and a two-option Open / Locked choice
     with a one-line explanation of each. If the player already has a waiting
     match, the form is replaced by a note linking to it.
  2. **Lobby**: one row per match, showing creator, size, gates, how long ago
     it was created, and a lock icon plus label for locked matches (the
     label means the icon is not the only signal). The row's button follows the caller's
     state: *Join* (open), *Request to join* (locked, none), *Requested* plus
     *Withdraw* (pending), *Declined* (disabled). An empty lobby says so and
     points at the New match form.
  3. **Your matches**: as now, without the "Share this code" line.
- **`JoinMatchForm` is removed**, along with the code input.
- **Creator's waiting screen** (`match-lobby.tsx`), when `awaiting_opponent`:
  - open: "Waiting for an opponent — your match is in the lobby."
  - locked: the Share button, and a **Requests** list (name, when asked,
    Accept, Decline). Empty: "No requests yet." Accept seats that player, and
    the screen moves on to drawing through the existing match-channel ping.
  - Cancel stays.
- **A requester** whose request is accepted while they are on `/matches` or
  the join page is taken to the match. If they are elsewhere in the app, they
  find it under "Your matches". *(Builder-writer's call: no app-wide
  notification.)*
- All new strings in `en.json` and `sk.json`. Colours from tokens only.
  Errors travel as message keys.

### Spec amendments to make in the main design

- §1 step 1–2: players meet through the lobby, or a share link for locked
  matches.
- §6: `match.access`, `match_request`, the partial unique index; `code` is a
  label.
- §8: the two new channels.
- §9: `awaiting_opponent` = "in the lobby"; cancel also clears requests.
- §12: the e2e list below.
- §16: remove "Public lobby" from out of scope (random matchmaking stays out).
- §17: "How do players meet?" → lobby, locked matches with requests, share
  link.

## Testing

- **Unit:** `parseChannel` round-trips the `lobby` and `user` kinds and
  rejects malformed names. The subscription rule for the new kinds: lobby for
  anyone, a user channel only for its owner. `next` validation (relative path
  accepted; `//evil`, `https://…` and empty rejected).
- **Integration (real database):**
  - The lobby query excludes the caller's own matches, non-waiting matches and
    expired matches, and reports request state.
  - Creating a second waiting match is refused, both through the procedure
    check and directly at the index.
  - Creating a match while your previous waiting match is past its deadline
    abandons the old one and succeeds.
  - Joining an open match works; joining a locked one is `matchLocked`.
  - Request → accept seats the player, deletes all requests and moves the
    match to `drawing`.
  - Decline blocks re-requesting. Withdraw allows it.
  - A non-creator cannot accept, decline or read `requests`.
  - Two concurrent accepts of different requesters: exactly one is seated.
  - Accept after withdraw is `requestGone`.
  - Cancel removes the requests.
  - A requester fails `canSubscribe` for the match's channels.
  - `preview` is `NOT_FOUND` for missing, expired and drawing matches alike.
- **E2E (new `e2e/matchmaking.spec.ts`; `e2e/lobby.spec.ts` already holds the
  waiting-screen and maze-picker tests and keeps them):** `e2e/support/match.ts`
  and `e2e/lobby.spec.ts` join through the lobby instead of by code.
  - Two browsers, open match: it appears in the guest's lobby live, the guest
    joins, and both players are drawing.
  - Locked match: the guest requests, the host sees the request live and
    accepts, and the guest lands in the match.
  - Decline: the guest sees *Declined*.
  - The share link opened by a signed-out guest goes through sign-in and back
    to the join page. In tests the Share button is checked through its
    clipboard fallback.
  - Mobile project included.

## Left to the builder

- Migration details, and backfilling `access = 'open'` for existing rows.
  There are no real players yet (the owner is the only user), so existing
  data needs no care. Before creating the one-waiting-match index, the
  migration abandons every creator's waiting matches except the newest,
  which is enough for the index to apply cleanly.
- Component structure, file names and exact copy, within the decisions above.
- Whether lobby rows show relative ("5 min ago") or absolute times.
- How `seatOpponent`'s signature handles the `PlayerRow` it now builds inline.
