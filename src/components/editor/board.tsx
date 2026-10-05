"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  cellKey,
  edgeKey,
  type DraftMaze,
  type Edge,
  type Point,
} from "~/maze";
import { gateColour } from "./gate-colours";

export const FRAME = 16;
export const CELL_PX = 40;
/** Invisible hit strip for an edge. A wall is one pixel; this is what you click. */
const EDGE_HIT = 14;

/** Every square of the frame. Fixed by `FRAME` alone, so built once. */
const ALL_CELLS: Point[] = (() => {
  const cells: Point[] = [];
  for (let y = 0; y < FRAME; y += 1) {
    for (let x = 0; x < FRAME; x += 1) cells.push({ x, y });
  }
  return cells;
})();

/**
 * Every interior edge of the frame, each with its one legal spelling. Fixed
 * by `FRAME` alone, so built once rather than on every render.
 */
const ALL_EDGES: Edge[] = (() => {
  const edges: Edge[] = [];
  for (let y = 0; y < FRAME; y += 1) {
    for (let x = 0; x < FRAME; x += 1) {
      if (y < FRAME - 1) edges.push({ o: "H", x, y });
      if (x < FRAME - 1) edges.push({ o: "V", x, y });
    }
  }
  return edges;
})();

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
  const keyGateAt = new Map(draft.keys.map((k) => [cellKey(k), k.gate]));
  const segmentAt = new Map(draft.segments.map((s) => [edgeKey(s), s]));

  // Roving tabindex: cells and edges are each their own focus group, so Tab
  // visits the grid once per group instead of once per square. The live stop
  // is whichever target last fired `onFocus` — a click, an arrow move, and a
  // Tab landing all go through the same DOM focus event, so none of them can
  // leave the stored stop pointing somewhere else. A group not in the DOM
  // (edges when `edgesActive` is false) contributes no stops at all.
  const [focusedCell, setFocusedCell] = useState<Point>({ x: 0, y: 0 });
  const [focusedEdgeIndex, setFocusedEdgeIndex] = useState(0);
  const cellRefs = useRef(new Map<string, SVGRectElement>());
  const edgeRefs = useRef(new Map<string, SVGRectElement>());

  // Edges mount and unmount with the active tool; start the group over at
  // its first member each time it reappears, rather than keeping a stop that
  // may not even render the same way (e.g. a wall placed while away).
  useEffect(() => {
    if (edgesActive) setFocusedEdgeIndex(0);
  }, [edgesActive]);

  // The live tab stop is set from `onFocus`, not from here — that covers a
  // click or a programmatic focus the same way it covers an arrow move,
  // instead of three places independently deciding whose turn tabIndex={0}
  // is next.
  function moveCellFocus(dx: number, dy: number, from: Point) {
    const next = { x: from.x + dx, y: from.y + dy };
    if (next.x < 0 || next.x >= FRAME || next.y < 0 || next.y >= FRAME) return;
    cellRefs.current.get(cellKey(next))?.focus();
  }

  function handleCellKeyDown(event: KeyboardEvent<SVGRectElement>, at: Point) {
    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault();
        onCell(at);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveCellFocus(0, -1, at);
        return;
      case "ArrowDown":
        event.preventDefault();
        moveCellFocus(0, 1, at);
        return;
      case "ArrowLeft":
        event.preventDefault();
        moveCellFocus(-1, 0, at);
        return;
      case "ArrowRight":
        event.preventDefault();
        moveCellFocus(1, 0, at);
        return;
      default:
        return;
    }
  }

  // Same reasoning as `moveCellFocus`: this only moves DOM focus, and lets
  // the target's own `onFocus` record it as the live stop.
  function moveEdgeFocus(delta: number) {
    const next = focusedEdgeIndex + delta;
    if (next < 0 || next >= ALL_EDGES.length) return;
    edgeRefs.current.get(edgeKey(ALL_EDGES[next]!))?.focus();
  }

  function handleEdgeKeyDown(event: KeyboardEvent<SVGRectElement>, edge: Edge) {
    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault();
        onEdge(edge);
        return;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        moveEdgeFocus(1);
        return;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        moveEdgeFocus(-1);
        return;
      default:
        return;
    }
  }

  function cellLabel(at: Point): string {
    const key = cellKey(at);
    const status = painted.has(key) ? t("cellPainted") : t("cellVoid");
    const label = t("cellLabel", { x: at.x, y: at.y, status });

    if (draft.start && cellKey(draft.start) === key) {
      return `${label}, ${t("cellStart")}`;
    }
    if (draft.treasure && cellKey(draft.treasure) === key) {
      return `${label}, ${t("cellTreasure")}`;
    }
    const gate = keyGateAt.get(key);
    if (gate !== undefined) return `${label}, ${t("cellKey", { gate })}`;
    return label;
  }

  function edgeLabel(edge: Edge): string {
    const segment = segmentAt.get(edgeKey(edge));
    const status = !segment
      ? t("edgeEmpty")
      : segment.kind === "wall"
        ? t("edgeWall")
        : t("edgeGate", { gate: segment.gate });
    return t("edgeLabel", { o: edge.o, x: edge.x, y: edge.y, status });
  }

  return (
    <svg
      data-board
      role="group"
      aria-label={t("boardLabel")}
      viewBox={`0 0 ${FRAME * CELL_PX} ${FRAME * CELL_PX}`}
      className="border-border-strong h-auto w-full max-w-[700px] rounded border"
    >
      {ALL_CELLS.map((at) => {
        const key = cellKey(at);
        const focused = focusedCell.x === at.x && focusedCell.y === at.y;
        return (
          <rect
            key={key}
            ref={(el) => {
              if (el) cellRefs.current.set(key, el);
              else cellRefs.current.delete(key);
            }}
            data-cell={`${at.x},${at.y}`}
            role="button"
            tabIndex={focused ? 0 : -1}
            aria-label={cellLabel(at)}
            x={at.x * CELL_PX}
            y={at.y * CELL_PX}
            width={CELL_PX}
            height={CELL_PX}
            className={
              painted.has(key)
                ? "fill-cell-painted stroke-grid-line"
                : "fill-cell-void stroke-grid-line"
            }
            strokeWidth={1}
            onClick={() => onCell(at)}
            onKeyDown={(event) => handleCellKeyDown(event, at)}
            onFocus={() => setFocusedCell(at)}
          />
        );
      })}

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
        ALL_EDGES.map((edge, index) => {
          const horizontal = edge.o === "H";
          const key = edgeKey(edge);
          const focused = index === focusedEdgeIndex;
          return (
            <rect
              key={`hit-${key}`}
              ref={(el) => {
                if (el) edgeRefs.current.set(key, el);
                else edgeRefs.current.delete(key);
              }}
              data-edge={key}
              role="button"
              tabIndex={focused ? 0 : -1}
              aria-label={edgeLabel(edge)}
              x={edge.x * CELL_PX + (horizontal ? 0 : CELL_PX - EDGE_HIT / 2)}
              y={edge.y * CELL_PX + (horizontal ? CELL_PX - EDGE_HIT / 2 : 0)}
              width={horizontal ? CELL_PX : EDGE_HIT}
              height={horizontal ? EDGE_HIT : CELL_PX}
              fill="transparent"
              onClick={() => onEdge(edge)}
              onKeyDown={(event) => handleEdgeKeyDown(event, edge)}
              onFocus={() => setFocusedEdgeIndex(index)}
            />
          );
        })}
    </svg>
  );
}
