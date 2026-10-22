"use client";

import { CELL_PX } from "~/components/editor/board";
import { MazeDrawing } from "~/components/maze-drawing";
import { mazeViewBox } from "~/lib/maze-view-box";
import type { Maze, Point } from "~/maze";

export type ResultMazeProps = {
  maze: Maze;
  path: readonly Point[];
  label: string;
  which: "theirs" | "yours";
};

/**
 * A finished maze, read-only, with one runner's path drawn over it. Only
 * painted cells are drawn: a void square is just background. The path is in
 * absolute maze coordinates, so it goes straight onto the maze.
 */
export function ResultMaze({ maze, path, label, which }: ResultMazeProps) {
  const last = path.at(-1);

  return (
    <figure data-result-maze={which} className="space-y-2">
      <figcaption className="text-sm font-medium">{label}</figcaption>
      <svg
        role="img"
        aria-label={label}
        viewBox={mazeViewBox(maze.cells, CELL_PX)}
        className="border-border-strong h-auto w-full max-w-[560px] rounded border"
      >
        <MazeDrawing maze={maze} />

        <polyline
          data-path
          data-points-count={path.length}
          points={path
            .map((p) => `${(p.x + 0.5) * CELL_PX},${(p.y + 0.5) * CELL_PX}`)
            .join(" ")}
          fill="none"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-accent"
          opacity={0.75}
        />
        {last && (
          <circle
            cx={(last.x + 0.5) * CELL_PX}
            cy={(last.y + 0.5) * CELL_PX}
            r={CELL_PX * 0.4}
            strokeWidth={2}
            className="stroke-accent fill-none"
          />
        )}
      </svg>
    </figure>
  );
}
