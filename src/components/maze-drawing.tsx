import { CELL_PX } from "~/components/editor/board";
import {
  GateSegment,
  KeyIcon,
  StartIcon,
  TreasureIcon,
} from "~/components/maze-icons";
import { mazeViewBox } from "~/lib/maze-view-box";
import { edgeKey, outlineEdges, type DraftMaze, type Edge } from "~/maze";

/**
 * Anything drawable: a finished maze, or a draft that may not have its start
 * or treasure yet. A `Maze` fits as it is.
 */
export type DrawableMaze = Pick<
  DraftMaze,
  "cells" | "segments" | "keys" | "start" | "treasure"
>;

/** Endpoints of the line an edge is drawn as, in board pixels. */
function edgeLine(edge: Edge) {
  const horizontal = edge.o === "H";
  return {
    x1: (edge.x + (horizontal ? 0 : 1)) * CELL_PX,
    y1: (edge.y + (horizontal ? 1 : 0)) * CELL_PX,
    x2: (edge.x + 1) * CELL_PX,
    y2: (edge.y + 1) * CELL_PX,
  };
}

/**
 * A whole maze, read-only, in board units: the painted cells (a void square
 * is just background), the start, the treasure, the keys, then the shape's
 * outline, walls and gates on top. Shared by the result screen, the replay,
 * the lobby's previews and the read-only labyrinth page, so none of them can
 * draw a maze differently. `dimTreasure` fades the treasure for a caller that
 * draws something over it.
 */
export function MazeDrawing({
  maze,
  dimTreasure = false,
}: {
  maze: DrawableMaze;
  dimTreasure?: boolean;
}) {
  return (
    <>
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

      {maze.start && (
        <StartIcon x={maze.start.x} y={maze.start.y} size={CELL_PX} />
      )}
      {maze.treasure && (
        <TreasureIcon
          x={maze.treasure.x}
          y={maze.treasure.y}
          size={CELL_PX}
          opacity={dimTreasure ? 0.4 : undefined}
        />
      )}

      {maze.keys.map((k) => (
        <KeyIcon
          key={`key-${k.gate}`}
          x={k.x}
          y={k.y}
          size={CELL_PX}
          gate={k.gate}
        />
      ))}

      {/* The shape's own border: implicit walls (spec §2.3), never stored. */}
      {outlineEdges(maze.cells).map((edge) => (
        <line
          key={`outline-${edgeKey(edge)}`}
          data-outline={edgeKey(edge)}
          {...edgeLine(edge)}
          strokeWidth={4}
          strokeLinecap="square"
          className="stroke-wall"
        />
      ))}

      {maze.segments.map((s) =>
        s.kind === "gate" ? (
          <GateSegment
            key={`seg-${edgeKey(s)}`}
            {...edgeLine(s)}
            gate={s.gate}
          />
        ) : (
          <line
            key={`seg-${edgeKey(s)}`}
            {...edgeLine(s)}
            strokeWidth={4}
            strokeLinecap="square"
            className="stroke-wall"
          />
        ),
      )}
    </>
  );
}

/**
 * A small thumbnail of one of the author's own mazes. Decorative: whatever
 * it sits in names the maze.
 */
export function MazePreview({ maze }: { maze: DrawableMaze }) {
  return (
    <svg
      data-maze-preview
      aria-hidden="true"
      viewBox={mazeViewBox(maze.cells, CELL_PX)}
      className="bg-cell-void aspect-square w-full rounded"
    >
      <MazeDrawing maze={maze} />
    </svg>
  );
}
