import { notFound } from "next/navigation";

import { MazeEditor } from "~/components/editor/maze-editor";
import { draftMazeSchema } from "~/maze";
import { api } from "~/trpc/server";

export default async function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const row = await api.maze.get({ id }).catch(() => null);
  if (!row) notFound();

  const parsed = draftMazeSchema.safeParse(row.data);
  if (!parsed.success) notFound();

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">{row.name}</h1>
      <MazeEditor
        id={row.id}
        initial={parsed.data}
        cellCount={row.cellCount}
        gateCount={row.gateCount}
      />
    </main>
  );
}
