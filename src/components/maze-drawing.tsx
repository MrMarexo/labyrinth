import { CELL_PX } from "~/components/editor/board";
import { gateColour } from "~/components/editor/gate-colours";
import { KeyIcon, StartIcon, TreasureIcon } from "~/components/maze-icons";
import { mazeViewBox } from "~/lib/maze-view-box";
import { edgeKey, type Maze } from "~/maze";

/**
 * A whole maze, read-only, in board units: the painted cells (a void square
 * is just background), the start, the treasure, the keys, then the walls and
 * gates on top. Shared by the result screen and the lobby's previews, so the
 * two can never draw a maze differently.
 */
export function MazeDrawing({ maze }: { maze: Maze }) {
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

      <StartIcon x={maze.start.x} y={maze.start.y} size={CELL_PX} />
      <TreasureIcon x={maze.treasure.x} y={maze.treasure.y} size={CELL_PX} />

      {maze.keys.map((k) => (
        <KeyIcon
          key={`key-${k.gate}`}
          x={k.x}
          y={k.y}
          size={CELL_PX}
          gate={k.gate}
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
    </>
  );
}

/**
 * A small thumbnail of one of the author's own mazes. Decorative: whatever
 * it sits in names the maze.
 */
export function MazePreview({ maze }: { maze: Maze }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={mazeViewBox(maze.cells, CELL_PX)}
      className="border-border bg-cell-void size-16 shrink-0 rounded border sm:size-20"
    >
      <MazeDrawing maze={maze} />
    </svg>
  );
}
