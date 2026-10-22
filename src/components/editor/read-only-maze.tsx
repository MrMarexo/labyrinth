"use client";

import { useTranslations } from "next-intl";

import { CELL_PX } from "~/components/editor/board";
import { MazeDrawing } from "~/components/maze-drawing";
import { Link } from "~/i18n/navigation";
import { mazeViewBox } from "~/lib/maze-view-box";
import type { Maze } from "~/maze";

export type ReadOnlyMazeProps = {
  name: string;
  cellCount: number;
  gateCount: number;
  maze: Maze;
};

/**
 * A labyrinth that has been used in a match: shown, never edited. No tools
 * and no autosave, so nothing here can even attempt a save.
 */
export function ReadOnlyMaze({
  name,
  cellCount,
  gateCount,
  maze,
}: ReadOnlyMazeProps) {
  const t = useTranslations("labyrinths");

  return (
    <div data-maze-readonly className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{name}</h1>
        <p className="text-muted text-sm">
          {t("summary", { squares: cellCount, gates: gateCount })}
        </p>
      </div>
      <p>{t("readOnly")}</p>
      <svg
        role="img"
        aria-label={name}
        viewBox={mazeViewBox(maze.cells, CELL_PX)}
        className="border-border-strong bg-cell-void h-auto w-full max-w-[560px] rounded border"
      >
        <MazeDrawing maze={maze} />
      </svg>
      <Link href="/labyrinths" className="inline-block text-sm underline">
        {t("backToList")}
      </Link>
    </div>
  );
}
