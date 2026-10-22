import { notFound } from "next/navigation";

import { MazeEditor } from "~/components/editor/maze-editor";
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

  const parsed = draftMazeSchema.safeParse(row.data);
  if (!parsed.success) notFound();

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

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">{row.name}</h1>
      <MazeEditor
        id={row.id}
        name={row.name}
        initial={parsed.data}
        cellCount={row.cellCount}
        gateCount={row.gateCount}
        forMatch={forMatch}
      />
    </main>
  );
}
