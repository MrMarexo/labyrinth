import { CELL_PX } from "~/components/editor/board";
import {
  GateSegment,
  KeyIcon,
  StartIcon,
  TreasureIcon,
} from "~/components/maze-icons";
import {
  pixelWalls,
  squaresPath,
  TILE_CHIP,
  TILE_GAP,
  tilesPath,
  WALL_WIDTH,
} from "~/components/pixel-geometry";
import { mazeViewBox } from "~/lib/maze-view-box";
import {
  edgeKey,
  outlineEdges,
  type DraftMaze,
  type Edge,
  type Point,
} from "~/maze";

/**
 * Anything drawable: a finished maze, or a draft that may not have its start
 * or treasure yet. A `Maze` fits as it is.
 */
export type DrawableMaze = Pick<
  DraftMaze,
  "cells" | "segments" | "keys" | "start" | "treasure"
>;

/** A start or treasure with the runner on it. */
const UNDER_RUNNER_OPACITY = 0.4;

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
 * draw a maze differently. `runnerAt` is the square a caller draws a runner
 * on: the start or treasure there fades, so the runner reads on top of it.
 */
export function MazeDrawing({
  maze,
  runnerAt,
}: {
  maze: DrawableMaze;
  runnerAt?: Point;
}) {
  const under = (p: Point | null) =>
    runnerAt !== undefined && p?.x === runnerAt.x && p.y === runnerAt.y;

  const outline = outlineEdges(maze.cells);
  const walls = pixelWalls(
    [...outline, ...maze.segments.filter((s) => s.kind !== "gate")],
    CELL_PX,
    WALL_WIDTH,
  );

  return (
    <>
      <path d={squaresPath(maze.cells, CELL_PX)} className="fill-grid-line" />
      <path
        data-squares={maze.cells.length}
        d={tilesPath(maze.cells, CELL_PX, TILE_GAP, TILE_CHIP)}
        className="fill-cell-painted"
      />

      {maze.start && (
        <StartIcon
          data-maze-start=""
          x={maze.start.x}
          y={maze.start.y}
          size={CELL_PX}
          opacity={under(maze.start) ? UNDER_RUNNER_OPACITY : undefined}
        />
      )}
      {maze.treasure && (
        <TreasureIcon
          data-maze-treasure=""
          x={maze.treasure.x}
          y={maze.treasure.y}
          size={CELL_PX}
          opacity={under(maze.treasure) ? UNDER_RUNNER_OPACITY : undefined}
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
      {outline.map((edge) => (
        <line
          key={`outline-${edgeKey(edge)}`}
          data-outline={edgeKey(edge)}
          {...walls.line(edge)}
          strokeWidth={WALL_WIDTH}
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
            {...walls.line(s)}
            strokeWidth={WALL_WIDTH}
            strokeLinecap="square"
            className="stroke-wall"
          />
        ),
      )}
      {walls.corners.map((pixel) => (
        <rect key={`${pixel.x},${pixel.y}`} {...pixel} className="fill-wall" />
      ))}
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
      className="bg-cell-void pixel aspect-square w-full"
    >
      <MazeDrawing maze={maze} />
    </svg>
  );
}
