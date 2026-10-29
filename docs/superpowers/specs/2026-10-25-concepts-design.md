# Concepts: one labyrinth in progress, saved on purpose

Date: 2026-10-25. Amends `2026-10-23-labyrinth-library-design.md` (states,
limit, and its non-goal "editing a used labyrinth").

## Why

Every labyrinth used to land in the player's library the moment it was
created, and autosaved there half-drawn. A labyrinth used in a match could
never be changed at all. The owner wants the library to hold only what the
player chose to keep, and wants a used labyrinth to be editable as a copy.

## The concept

- Each player has at most one **concept** (sk: koncept): a `maze` row with
  `concept = true`, enforced by a partial unique index. It autosaves exactly
  as drafts did.
- It is listed first on `/labyrinths`, outside the filters, with a
  "Concept" badge. It does not count toward the 10-labyrinth limit.
- A concept becomes a saved labyrinth only through **Save labyrinth** in the
  editor (`maze.saveConcept`), which appears in place of "Use in this match"
  when the editor was not opened from a match, and is enabled once the
  concept is valid and autosaved. Saving refuses at the limit.
- Using a concept in a match (`match.submitMaze`) saves it as well, never
  refused for the limit: a match must not be blocked by the library.

## Replacing the concept

New labyrinth, the lobby's Draw a new one, and opening a saved labyrinth each replace the
player's concept. Each is refused with `errors.conceptExists` unless the
call says `replace: true`; the client then asks in a popup ("Delete your
concept?", naming it) and repeats the call. No popup when nothing would be
lost:

- An empty concept is replaced without asking.
- Draw a new one hands back an empty concept already at the match's size.
- Opening a saved labyrinth hands back the concept already editing it, a
  copy included, and replaces an unchanged copy of another one.

## Editing a saved labyrinth

Opening a saved labyrinth goes straight to the editor, through
`maze.editAsConcept` (amended 2026-10-29; it used to open read-only, with an
**Edit** button). A concept that is empty, or an unchanged copy of its
labyrinth, is replaced without asking and discarded when the editor is left,
so just looking at a labyrinth never leaves a concept behind to ask about.

- **Ready** (or an unfinished one saved before concepts): the concept keeps
  the name and records `sourceId`. Saving writes the concept's drawing back
  into that labyrinth and deletes the concept. If the original was used or
  deleted in the meantime, the concept is saved as a new labyrinth instead.
- **Used**: the button reads "Edit a copy". The concept is a copy named
  "Edit of {name}"; it records `sourceId` too, but saving never writes into
  a used labyrinth, so it adds a new one. The used one is never changed.

`maze.saveDraft` now autosaves concepts only (`errors.mazeIsSaved`
otherwise).

## Match picker

`match.eligibleMazes` also returns the concept when its squares and gates
match the match, with `concept` and `valid` flags. A valid concept is
offered like any other labyrinth; an unfinished one is offered as a "Finish
your concept" link to the editor with `?match=`.

## Migration

`0009` adds `concept` and `source_id`, deletes empty unfinished drafts
(left behind by opening the editor and leaving), and makes each player's
newest remaining unfinished draft their concept so work in progress carries over. Older
unfinished drafts stay saved, shown under the "Unfinished" filter (formerly
"Drafts"), and can be edited through a concept like any saved labyrinth.

## Already faced

An unchanged "Edit of" copy is a new id with the same drawing, so
`mazesFacedBy` now compares `contentHash`, not ids: the copy is the maze
the opponent has already faced.
