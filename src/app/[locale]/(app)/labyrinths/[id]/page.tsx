import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { MazeEditor } from "~/components/editor/maze-editor";
import { ReadOnlyMaze } from "~/components/editor/read-only-maze";
import { SignUpNotice } from "~/components/sign-up-notice";
import { mayUseInMatch } from "~/match";
import { draftMazeSchema, draftToMaze } from "~/maze";
import { api } from "~/trpc/server";

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ match?: string | string[] }>;
}) {
  const { id } = await params;
  const t = await getTranslations("editor");
  const { match: matchId } = await searchParams;

  const row = await api.maze.get({ id }).catch(() => null);
  if (!row) notFound();

  // A guest has no library: only the concept they are drawing for their
  // match, opened from it, is theirs to see.
  const guest = (await api.viewer.get()).kind === "guest";
  const guestNotice = (
    <main className="mx-auto max-w-3xl p-8">
      <SignUpNotice kind="labyrinths" />
    </main>
  );
  if (guest && !row.concept) return guestNotice;

  const parsed = draftMazeSchema.safeParse(row.data);
  if (!parsed.success) notFound();

  // Saved: shown, and changed only through a concept (its Edit button).
  if (!row.concept) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <ReadOnlyMaze
          id={row.id}
          name={row.name}
          cellCount={row.cellCount}
          gateCount={row.gateCount}
          maze={draftToMaze(parsed.data)}
          used={row.status === "submitted"}
        />
      </main>
    );
  }

  // The labyrinth this concept saves back into, named in its note. Gone or
  // used since, the concept saves on its own, and the note says nothing.
  const source = row.sourceId
    ? await api.maze.get({ id: row.sourceId }).catch(() => null)
    : null;
  const sourceName = source?.status === "draft" ? source.name : null;

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
    // Wide, unlike the other pages: the board grows to fill the screen.
    <main className="mx-auto max-w-[120rem] space-y-6 px-4 py-6 lg:px-8">
      <div className="space-y-1">
        <h1 className="text-2xl">{row.name}</h1>
        <p data-concept-note className="text-muted text-sm">
          {sourceName ? t("conceptOf", { name: sourceName }) : t("conceptNote")}
        </p>
      </div>
      <MazeEditor
        id={row.id}
        initial={parsed.data}
        version={row.version}
        cellCount={row.cellCount}
        gateCount={row.gateCount}
        forMatch={forMatch}
        savesInto={sourceName !== null}
      />
    </main>
  );
}
