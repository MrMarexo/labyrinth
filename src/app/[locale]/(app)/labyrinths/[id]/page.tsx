import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";

import { MazeEditor } from "~/components/editor/maze-editor";
import { OpenSavedMaze } from "~/components/editor/open-saved-maze";
import { SignUpNotice } from "~/components/sign-up-notice";
import { redirect } from "~/i18n/navigation";
import { mayUseInMatch } from "~/match";
import { draftMazeSchema } from "~/maze";
import { api } from "~/trpc/server";

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ match?: string | string[] }>;
}) {
  const { id } = await params;
  const { match: matchId } = await searchParams;

  const row = await api.maze.get({ id }).catch(() => null);
  if (!row) notFound();

  // A guest has no library: only the concept they are drawing for their
  // match, opened from it, is theirs to see.
  const guest = (await api.viewer.get()).kind === "guest";
  const guestNotice = (
    <main className="mx-auto max-w-5xl p-8">
      <SignUpNotice kind="labyrinths" />
    </main>
  );
  if (guest && !row.concept) return guestNotice;

  // Saved: never edited in place, so it opens as the author's concept.
  // Only when that would delete a different concept does the page stop,
  // for the client to ask first.
  if (!row.concept) {
    const concept = await api.maze
      .editAsConcept({ id: row.id })
      .catch((error: unknown) => {
        if (
          error instanceof TRPCError &&
          error.message === "errors.conceptExists"
        )
          return null;
        throw error;
      });
    if (!concept) {
      return (
        <main className="mx-auto max-w-5xl p-8">
          <OpenSavedMaze id={row.id} />
        </main>
      );
    }
    redirect({ href: `/labyrinths/${concept.id}`, locale: await getLocale() });
  }

  const parsed = draftMazeSchema.safeParse(row.data);
  if (!parsed.success) notFound();

  // The labyrinth this concept saves back into. Deleted since, the concept
  // saves on its own.
  const source = row.sourceId
    ? await api.maze.get({ id: row.sourceId }).catch(() => null)
    : null;

  // Opened from a match's lobby: offer to use the maze there, but only if
  // that could succeed. A match the caller is not in reads the same as one
  // that does not exist, and either way the param is quietly ignored.
  const match =
    typeof matchId === "string"
      ? await api.match.get({ id: matchId }).catch(() => null)
      : null;
  const forMatch =
    match && mayUseInMatch(match, row)
      ? { id: match.id, code: match.code }
      : null;
  if (guest && !forMatch) return guestNotice;

  return (
    // Wide, unlike the other pages: the board grows to fill the screen. On a
    // desktop exactly the screen below the header, so it never scrolls.
    <main className="mx-auto flex max-w-[120rem] flex-col gap-4 px-4 py-6 lg:h-[calc(100dvh-var(--header-h))] lg:px-8">
      <h1 className="shrink-0 text-2xl">{row.name}</h1>
      <MazeEditor
        id={row.id}
        initial={parsed.data}
        version={row.version}
        cellCount={row.cellCount}
        gateCount={row.gateCount}
        forMatch={forMatch}
        savesInto={source !== null}
      />
    </main>
  );
}
