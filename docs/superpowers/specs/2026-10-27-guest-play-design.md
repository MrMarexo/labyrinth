# Guest play: joining a match without an account

Date: 2026-10-27. Amends `2026-09-22-labyrinth-design.md` (accounts),
`2026-10-23-match-lobby-design.md` (lobby and share link) and
`2026-10-25-concepts-design.md` (library).

## Why

Today every page but sign-in and sign-up needs an account, so a friend who
gets a share link has to sign up before they can see what they were invited
to. The owner wants someone without an account to be able to join a game and
play it, and to sign up only once they want to create things or keep them.

## What a guest is

- A **guest** is a real `user` row created by Better Auth's anonymous plugin
  (`isAnonymous = true`), with a session cookie like any other user's. Every
  table that hangs off a user (seats, moves, requests, concepts, realtime
  access) keeps working with no special case.
- A guest is shown as **"Guest 4821"** (sk: "Hosť 4821"): a random number
  chosen at creation. The text around the number comes from `messages/`
  (invariant 9); how the number is stored is left to the builder.
- A guest lives in one browser. Clearing cookies, or opening another browser,
  makes a new guest. That is accepted.
- **A guest is just another player.** A match creator gets no setting to keep
  guests out. A guest joins open matches directly, requests locked ones, and
  shows up in the creator's request list under their guest name.

## When a guest is made

Never just for looking. A visitor without a session can browse, and a guest
is created only when they act: the **Join** or **Request** button on a lobby
row or on the share-link page. For a visitor, that button reads
**"Join as guest"** / **"Request as guest"**. It signs in anonymously and then
makes the same call a signed-in player makes. Next to it is a **Sign in**
link, which comes back to the same page afterwards (`next=`), for anyone who
already has an account.

## What a guest and a visitor can see

| Page | Visitor (no session) | Guest | Signed in |
| --- | --- | --- | --- |
| `/` | Name, tagline, sign-up and sign-in links, link to `/matches` | Same as visitor, plus a link back to their current match if they have one | As now |
| `/matches` | Lobby (read-only list with "Join as guest"), sign-up notice in place of the new-match form | Lobby and current match, sign-up notice in place of the new-match form, no match history | As now |
| `/matches/[id]/join` | Preview with "Join as guest" and Sign in | Preview with Join | As now |
| `/matches/[id]` (and the editor with `?match=`) | Sign-in redirect | Their own match only: drawing, running, result | As now |
| `/labyrinths`, `/labyrinths/[id]` | A sign-up notice only | A sign-up notice only | As now |
| `/profile` | Sign-in redirect | Redirect to sign-up | As now |

- The **sign-up notice** on `/matches` always says that you need an account
  to create matches and labyrinths, with a sign-up link (and a sign-in link).
- **No history.** A guest never gets a list of their past matches.
  *My call:* the **current match** banner (`CurrentMatch`) still shows for a
  guest whose match is not over, so leaving the page mid-match is not the end
  of the game. Once a match ends there is no way back to it from the UI.
- The **site header** for a guest shows "Guest 4821" with Sign up and Sign in.
  There is no profile or settings item. The language switcher works as it
  does for a visitor.

## What a guest can't do

These rules are enforced on the server, not only hidden in the UI. Every
procedure a guest must not use refuses `isAnonymous` users with
`errors.guestNotAllowed` (a message key, invariant 3):

- `match.create`, `match.list`. `CurrentMatch` and the home summary read
  `match.list` today, so a guest-safe "current match" read takes its place
  for guests.
- Every `maze.*` procedure except those the editor needs while drawing a maze
  for a match the guest sits in (autosaving the concept, opening the editor
  with `?match=`).
- `profile.*`.

`protectedProcedure` stays as it is. A new `memberProcedure` (name left to
the builder) adds the non-guest check, so new procedures are guest-safe only
when someone chooses that on purpose.

**Drawing a maze.** A guest draws their maze in the editor exactly as a
signed-in player does from a match. The concept mechanism carries it. The
library rules (limit, Save labyrinth, the `/labyrinths` list) never apply to a
guest, because a guest never reaches them.

## What is left behind

- **The guest's maze disappears after the review window.** When a guest
  submits a maze to a match, the maze is marked deleted (`deletedAt` set to
  the submission time). From then on it behaves exactly like a maze its
  author deleted (concepts spec, library spec): the opponent's result and
  replay show it for `REPLAY_RETENTION_DAYS` (30) after the match ends, then
  the nightly `purgeDeletedMazes` removes it for good and the result shows
  the existing "This labyrinth was deleted" note. No new purge is needed.
- **The guest's user row stays.** `match_player.user_id` cascades on user
  delete, so removing a guest who played would take the opponent's result
  with it, and results stay forever. For a guest who never signs up, the row
  is what lets the opponent's result keep saying "Guest 4821".
- **Guests who never played are removed.** The nightly cron deletes guest
  users older than 30 days who have no `match_player` row (their concept and
  requests go with them by cascade). *My call* on the 30 days.

## Signing up keeps the game

When a guest signs up, or signs in to an existing account, from the guest
session, everything they had moves to that account: Better Auth's
`onLinkAccount` hook reassigns, in one transaction,

- `match_player.user_id`, `move.runner_id`, `match.winner_id`,
  `match_request.user_id`,
- `maze.author_id`, and clears `deletedAt` on the mazes the guest submitted,
  so the maze becomes a **used labyrinth** in the new owner's library. Like
  `match.submitMaze`, this is never refused for the 10-labyrinth limit.
- The guest's concept, if any, becomes the account's concept if the account
  has none. If both have one, *my call:* the guest's wins when the guest
  still has an unsubmitted seat in a `drawing` match (it is that match's
  drawing). The account's concept is then kept as an unfinished labyrinth in
  its library, never refused for the limit. Otherwise the guest's concept is
  dropped.

Once moved, those matches show the **account's real name** everywhere:
the opponent's history, results, replays and request lists. The owner chose
this; no per-match name is stored.

Then the guest row is deleted. The plugin deletes the anonymous user itself
after `onLinkAccount`, so set `disableDeleteAnonymousUser` and delete the row
in the hook, only after the reassign has committed.

*My call* for two edge cases:

- **The account is already in the same match** (it created the match the
  guest joined). The two seats can't merge, so that match stays with the
  guest row, and the guest row is kept instead of deleted.
- **Both the account and the guest have an active match.** Both carry over.
  The one-active-match rule (`activeMatchOf`) applies only when joining or
  creating, so the account simply can't join a third match until one ends.
  The builder checks that `CurrentMatch` and the home summary cope with two.

## Auth plumbing

- The `(auth)` layout sends anyone with a session away from sign-in and
  sign-up. A guest session must be let through, so a guest can link.
- The editor is `/labyrinths/[id]?match=`. A guest may open it only for their
  own concept, in a match they sit in. Every other `/labyrinths` URL shows
  the sign-up notice.
- Better Auth's 3-per-10s limit on `/sign-in*` also covers
  `/sign-in/anonymous`. Give it a custom, looser rule, so friends on one
  network can all join at once.

## Lobby for visitors

`match.lobby` and `match.preview` become readable without a session (a
`publicProcedure`). They already read no maze columns (invariant 1), so this
exposes nothing new beyond creators' display names. A visitor's lobby polls.
Realtime stays for sessions: the `lobby` channel is open to any session,
which now includes guests, and invariant 12 is unchanged.

## Non-goals

- Guest nicknames, avatars, or anything to tell guests apart beyond the
  number.
- Recovering a guest's game in another browser.
- Spectating or a public match list beyond the lobby.
- Any change to how a match plays once both players are seated.

## Anti-goals

- **A guest learning a maze.** Guests go through the same runner-facing
  procedures as everyone else (invariant 1). Nothing guest-specific may read
  `maze.data` except a guest's own maze in the editor.
- **The opponent losing their result** because a guest left, expired or
  signed up. Every cleanup above keeps the `match_player` rows.
- **Guest rows piling up from people who only looked.** No guest is created
  for a page view.

## Testing

- Router tests: every guest-refused procedure refuses an anonymous user;
  `lobby` and `preview` work without a session; linking moves seats, moves,
  requests and mazes, clears `deletedAt`, and handles the same-match case.
- Purge test: a guest's submitted maze is purged 30 days after the match
  ends, and the opponent's result keeps its row.
- Cleanup test: a guest with no seat older than 30 days is deleted; one with a
  seat is not.
- e2e: a visitor opens a share link, joins as a guest, draws, plays to the
  result; `/matches` shows the sign-up notice and no history; `/labyrinths`
  shows only the notice; signing up from the result page shows the match in
  the new account's history and the maze in its library.

## Left to the builder

- How the guest number is stored and rendered (a column, or the name field
  holding only the number), as long as the words come from `messages/`.
- Exactly which `maze.*` procedures the editor needs for a match, and so stay
  open to guests.
- Whether the visitor's lobby polls on the same interval as the signed-in
  fallback.
- Copy for the notices, in both catalogues.
