"use client";

import { useTranslations } from "next-intl";

import { CELL_PX } from "~/components/editor/board";
import { useReplaceConcept } from "~/components/editor/replace-concept";
import { MazeDrawing } from "~/components/maze-drawing";
import { Link } from "~/components/link";
import { useRouter } from "~/i18n/navigation";
import { mazeViewBox } from "~/lib/maze-view-box";
import type { Maze } from "~/maze";
import { api } from "~/trpc/react";

export type ReadOnlyMazeProps = {
  id: string;
  name: string;
  cellCount: number;
  gateCount: number;
  /** Null for a saved labyrinth that never validated. */
  maze: Maze | null;
  /** Used in a match: editing it makes a copy. */
  used: boolean;
};

/**
 * A saved labyrinth: shown, never edited in place. No tools and no
 * autosave, so nothing here can even attempt a save. Edit opens it as the
 * author's concept, which is where changes are made.
 */
export function ReadOnlyMaze({
  id,
  name,
  cellCount,
  gateCount,
  maze,
  used,
}: ReadOnlyMazeProps) {
  const t = useTranslations("labyrinths");

  return (
    <div data-maze-readonly className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl">{name}</h1>
        <p className="text-muted text-sm">
          {t("summary", { squares: cellCount, gates: gateCount })}
        </p>
      </div>
      {used && <p>{t("readOnly")}</p>}
      <EditMaze id={id} name={name} used={used} />
      {maze ? (
        <svg
          role="img"
          aria-label={name}
          viewBox={mazeViewBox(maze.cells, CELL_PX)}
          className="border-border-strong bg-cell-void pixel h-auto w-full max-w-[560px] border"
        >
          <MazeDrawing maze={maze} />
        </svg>
      ) : (
        <div className="bg-cell-void pixel aspect-square w-full max-w-[560px]" />
      )}
      <Link href="/labyrinths" className="inline-block text-sm">
        {t("backToList")}
      </Link>
    </div>
  );
}

/**
 * Opens the labyrinth as the author's concept, asking first when that
 * would delete a different concept. The server hands back the concept
 * already editing this labyrinth without asking.
 */
function EditMaze({
  id,
  name,
  used,
}: {
  id: string;
  name: string;
  used: boolean;
}) {
  const t = useTranslations("labyrinths");
  const te = useTranslations();
  const router = useRouter();
  const utils = api.useUtils();
  const edit = api.maze.editAsConcept.useMutation({
    onSuccess: ({ id: conceptId }) => {
      void utils.maze.list.invalidate();
      router.push(`/labyrinths/${conceptId}`);
    },
  });
  const { error, dialog } = useReplaceConcept(edit);
  const busy = edit.isPending || edit.isSuccess;

  return (
    <div className="space-y-2">
      <button
        type="button"
        data-edit-maze
        disabled={busy}
        onClick={() =>
          edit.mutate({
            id,
            // At most 80 characters, like any name.
            copyName: t("editOfName", { name }).slice(0, 80),
          })
        }
        className="bg-accent text-on-accent pixel px-3 py-2 text-sm disabled:opacity-50"
      >
        {busy ? t("editing") : used ? t("editCopy") : t("edit")}
      </button>
      {error && (
        <p role="alert" data-edit-error className="text-danger text-sm">
          {te(error.key as never, error.params as never)}
        </p>
      )}
      {dialog}
    </div>
  );
}
