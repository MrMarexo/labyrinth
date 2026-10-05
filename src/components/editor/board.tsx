"use client";

import { useTranslations } from "next-intl";

import {
  cellKey,
  edgeKey,
  type DraftMaze,
  type Edge,
  type Point,
} from "~/maze";

export const FRAME = 16;
export const CELL_PX = 40;
/** Invisible hit strip for an edge. A wall is one pixel; this is what you click. */
const EDGE_HIT = 14;

const GATE_HUES = [25, 70, 140, 190, 260, 300, 340, 10];

/**
 * Gate colours reuse the accent and danger tokens — so they stay correct in
 * both themes — rotated to a per-gate hue. Odd gates read off the accent,
 * even gates off danger, which keeps adjacent gate numbers visually distinct
 * even before the hue difference registers.
 */
function gateColour(gate: number): string {
  const hue = GATE_HUES[(gate - 1) % GATE_HUES.length];
  const base = gate % 2 === 0 ? "var(--color-danger)" : "var(--color-accent)";
  return `oklch(from ${base} l c ${hue})`;
}

export type BoardProps = {
  draft: DraftMaze;
  onCell: (at: Point) => void;
  onEdge: (edge: Edge) => void;
  /** Edges are only clickable when the active tool places something on one. */
  edgesActive: boolean;
};

export function Board({ draft, onCell, onEdge, edgesActive }: BoardProps) {
  const t = useTranslations("editor");
  const painted = new Set(draft.cells.map(cellKey));

  const cells: Point[] = [];
  for (let y = 0; y < FRAME; y += 1) {
    for (let x = 0; x < FRAME; x += 1) cells.push({ x, y });
  }

  return (
    <svg
      data-board
      role="group"
      aria-label={t("boardLabel")}
      viewBox={`0 0 ${FRAME * CELL_PX} ${FRAME * CELL_PX}`}
      className="border-border-strong h-auto w-full max-w-[700px] rounded border"
    >
      {cells.map((at) => (
        <rect
          key={cellKey(at)}
          data-cell={`${at.x},${at.y}`}
          role="button"
          tabIndex={0}
          aria-label={t("cellLabel", { x: at.x, y: at.y })}
          x={at.x * CELL_PX}
          y={at.y * CELL_PX}
          width={CELL_PX}
          height={CELL_PX}
          className={
            painted.has(cellKey(at))
              ? "fill-cell-painted stroke-grid-line"
              : "fill-cell-void stroke-grid-line"
          }
          strokeWidth={1}
          onClick={() => onCell(at)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onCell(at);
          }}
        />
      ))}

      {draft.start && (
        <circle
          data-start
          aria-hidden="true"
          pointerEvents="none"
          cx={(draft.start.x + 0.5) * CELL_PX}
          cy={(draft.start.y + 0.5) * CELL_PX}
          r={CELL_PX * 0.3}
          className="fill-accent"
        />
      )}

      {draft.treasure && (
        <rect
          data-treasure
          aria-hidden="true"
          pointerEvents="none"
          x={(draft.treasure.x + 0.25) * CELL_PX}
          y={(draft.treasure.y + 0.25) * CELL_PX}
          width={CELL_PX * 0.5}
          height={CELL_PX * 0.5}
          className="fill-danger"
        />
      )}

      {draft.keys.map((key) => (
        <circle
          key={`key-${key.gate}`}
          data-key={key.gate}
          aria-hidden="true"
          pointerEvents="none"
          cx={(key.x + 0.5) * CELL_PX}
          cy={(key.y + 0.5) * CELL_PX}
          r={CELL_PX * 0.18}
          fill={gateColour(key.gate)}
        />
      ))}

      {draft.segments.map((segment) => {
        // {o:"H",x,y} sits between (x,y) and (x,y+1): a horizontal line one
        // cell down, spanning column x. {o:"V",x,y} sits between (x,y) and
        // (x+1,y): a vertical line one cell right, spanning row y.
        const horizontal = segment.o === "H";
        const x1 = (segment.x + (horizontal ? 0 : 1)) * CELL_PX;
        const y1 = (segment.y + (horizontal ? 1 : 0)) * CELL_PX;
        const x2 = (segment.x + 1) * CELL_PX;
        const y2 = (segment.y + 1) * CELL_PX;

        return (
          <line
            key={`seg-${edgeKey(segment)}`}
            data-segment={edgeKey(segment)}
            aria-hidden="true"
            pointerEvents="none"
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            strokeWidth={4}
            strokeLinecap="round"
            className={segment.kind === "wall" ? "stroke-wall" : undefined}
            stroke={
              segment.kind === "gate" ? gateColour(segment.gate) : undefined
            }
          />
        );
      })}

      {edgesActive &&
        edgesOf().map((edge) => {
          const horizontal = edge.o === "H";
          return (
            <rect
              key={`hit-${edgeKey(edge)}`}
              data-edge={edgeKey(edge)}
              role="button"
              tabIndex={0}
              aria-label={t("edgeLabel", {
                o: edge.o,
                x: edge.x,
                y: edge.y,
              })}
              x={edge.x * CELL_PX + (horizontal ? 0 : CELL_PX - EDGE_HIT / 2)}
              y={edge.y * CELL_PX + (horizontal ? CELL_PX - EDGE_HIT / 2 : 0)}
              width={horizontal ? CELL_PX : EDGE_HIT}
              height={horizontal ? EDGE_HIT : CELL_PX}
              fill="transparent"
              onClick={() => onEdge(edge)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onEdge(edge);
              }}
            />
          );
        })}
    </svg>
  );
}

/** Every interior edge of the frame, each with its one legal spelling. */
function edgesOf(): Edge[] {
  const edges: Edge[] = [];
  for (let y = 0; y < FRAME; y += 1) {
    for (let x = 0; x < FRAME; x += 1) {
      if (y < FRAME - 1) edges.push({ o: "H", x, y });
      if (x < FRAME - 1) edges.push({ o: "V", x, y });
    }
  }
  return edges;
}
