"use client";

import { CELL_PX } from "~/components/editor/board";
import { gateColour } from "~/components/editor/gate-colours";
import { edgeKey, type Maze, type Point } from "~/maze";

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
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of maze.cells) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  const viewBox = `${(minX - 0.5) * CELL_PX} ${(minY - 0.5) * CELL_PX} ${
    (maxX - minX + 2) * CELL_PX
  } ${(maxY - minY + 2) * CELL_PX}`;

  const last = path.at(-1);

  return (
    <figure data-result-maze={which} className="space-y-2">
      <figcaption className="text-sm font-medium">{label}</figcaption>
      <svg
        role="img"
        aria-label={label}
        viewBox={viewBox}
        className="border-border-strong h-auto w-full max-w-[560px] rounded border"
      >
        {maze.cells.map((c) => (
          <rect
            key={`${c.x},${c.y}`}
            x={c.x * CELL_PX}
            y={c.y * CELL_PX}
            width={CELL_PX}
            height={CELL_PX}
            className="fill-cell-painted stroke-grid-line"
            strokeWidth={1}
          />
        ))}

        <circle
          cx={(maze.start.x + 0.5) * CELL_PX}
          cy={(maze.start.y + 0.5) * CELL_PX}
          r={CELL_PX * 0.3}
          className="fill-accent"
        />
        <rect
          x={(maze.treasure.x + 0.25) * CELL_PX}
          y={(maze.treasure.y + 0.25) * CELL_PX}
          width={CELL_PX * 0.5}
          height={CELL_PX * 0.5}
          className="fill-danger"
        />

        {maze.keys.map((k) => (
          <circle
            key={`key-${k.gate}`}
            cx={(k.x + 0.5) * CELL_PX}
            cy={(k.y + 0.5) * CELL_PX}
            r={CELL_PX * 0.18}
            style={{ fill: gateColour(k.gate) }}
          />
        ))}

        {maze.segments.map((s) => {
          const horizontal = s.o === "H";
          return (
            <line
              key={`seg-${edgeKey(s)}`}
              x1={(s.x + (horizontal ? 0 : 1)) * CELL_PX}
              y1={(s.y + (horizontal ? 1 : 0)) * CELL_PX}
              x2={(s.x + 1) * CELL_PX}
              y2={(s.y + 1) * CELL_PX}
              strokeWidth={4}
              strokeLinecap="round"
              className={s.kind === "wall" ? "stroke-wall" : undefined}
              style={
                s.kind === "gate" ? { stroke: gateColour(s.gate) } : undefined
              }
            />
          );
        })}

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
