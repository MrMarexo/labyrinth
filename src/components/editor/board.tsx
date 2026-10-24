"use client";

import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  MAX_BOUNDING_BOX,
  cellKey,
  edgeKey,
  isInteriorEdge,
  outlineEdges,
  type DraftMaze,
  type Edge,
  type Point,
  type Tool,
} from "~/maze";
import {
  GateSegment,
  KeyIcon,
  StartIcon,
  TreasureIcon,
} from "~/components/maze-icons";
import {
  cellUnder,
  cellsBetween,
  inFrame,
  nearestInteriorEdge,
  samplesBetween,
} from "./hit-test";

export const FRAME = MAX_BOUNDING_BOX;
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
 * Every edge strictly inside the frame, each with its one legal spelling.
 * Fixed by `FRAME` alone, so built once; each render keeps only the ones
 * inside the painted shape.
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

/** Tools whose press-drag-release is one stroke; the rest act on a tap. */
const STROKE_TOOLS: ReadonlySet<Tool> = new Set([
  "paint",
  "erase-cell",
  "wall",
  "erase",
]);
/** Tools that act on an edge. The eraser acts on an edge or a square. */
const EDGE_TOOLS: ReadonlySet<Tool> = new Set(["wall", "gate", "erase"]);
/** Edge hit-tests along a swipe are this far apart, in cells. */
const SAMPLE_SPACING = 0.25;

type Target = { kind: "cell"; at: Point } | { kind: "edge"; edge: Edge };

function targetKey(target: Target | null): string {
  if (!target) return "";
  return target.kind === "cell"
    ? `c:${cellKey(target.at)}`
    : `e:${edgeKey(target.edge)}`;
}

/** Endpoints of the line an edge is drawn as, in board pixels. */
function edgeLine(edge: Edge) {
  // {o:"H",x,y} sits between (x,y) and (x,y+1): a horizontal line one
  // cell down, spanning column x. {o:"V",x,y} sits between (x,y) and
  // (x+1,y): a vertical line one cell right, spanning row y.
  const horizontal = edge.o === "H";
  return {
    x1: (edge.x + (horizontal ? 0 : 1)) * CELL_PX,
    y1: (edge.y + (horizontal ? 1 : 0)) * CELL_PX,
    x2: (edge.x + 1) * CELL_PX,
    y2: (edge.y + 1) * CELL_PX,
  };
}

type Stroke = {
  pointerId: number;
  /** Last pointer position, in cell units. */
  last: { x: number; y: number };
};

export type BoardProps = {
  draft: DraftMaze;
  tool: Tool;
  /** False once the square budget is spent, so paint previews nothing. */
  canPaint: boolean;
  /**
   * The gate or key number the gate or key tool places, or null when the
   * maze has no gates to number.
   */
  gate: number | null;
  /** The maze can no longer be edited, so nothing is previewed. */
  locked: boolean;
  /** A single activation: a tap, or Enter/Space on a focused target. */
  onCell: (at: Point) => void;
  onEdge: (edge: Edge) => void;
  /** A stroke tool's press; every target it passes over follows, then end. */
  onStrokeBegin: () => void;
  onStrokeCell: (at: Point) => void;
  onStrokeEdge: (edge: Edge) => void;
  onStrokeEnd: () => void;
};

/**
 * Renders every square — `data-cell` for all FRAME² cells, each labelled
 * painted or void — so this is the author's own board. A run view needs a
 * sibling component fed only discovered cells and bumped segments; reusing
 * this one leaks void-vs-walled into the accessibility tree.
 */
export function Board({
  draft,
  tool,
  canPaint,
  gate,
  locked,
  onCell,
  onEdge,
  onStrokeBegin,
  onStrokeCell,
  onStrokeEdge,
  onStrokeEnd,
}: BoardProps) {
  const t = useTranslations("editor");
  const edgesActive = EDGE_TOOLS.has(tool);
  const painted = new Set(draft.cells.map(cellKey));
  // Only edges with a painted square on both sides take a wall; the rest of
  // the shape's border is drawn as the outline and is never a target.
  const interiorEdges = ALL_EDGES.filter((e) => isInteriorEdge(e, painted));
  const keyGateAt = new Map(draft.keys.map((k) => [cellKey(k), k.gate]));
  const segmentAt = new Map(draft.segments.map((s) => [edgeKey(s), s]));

  // Roving tabindex: cells and edges are each their own focus group, so Tab
  // visits the grid once per group instead of once per square. The live stop
  // is whichever target last fired `onFocus` — a click, an arrow move, and a
  // Tab landing all go through the same DOM focus event, so none of them can
  // leave the stored stop pointing somewhere else. A group not in the DOM
  // (edges when `edgesActive` is false) contributes no stops at all.
  const [focusedCell, setFocusedCell] = useState<Point>({ x: 0, y: 0 });
  const [focusedEdge, setFocusedEdge] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, SVGRectElement>());
  const edgeRefs = useRef(new Map<string, SVGRectElement>());
  // The edge group's stop is kept by name, since the set of interior edges
  // changes with the shape; a stop that is no longer interior falls back to
  // the first one.
  const storedEdgeIndex = interiorEdges.findIndex(
    (e) => edgeKey(e) === focusedEdge,
  );
  const focusedEdgeIndex = storedEdgeIndex === -1 ? 0 : storedEdgeIndex;

  // Edges mount and unmount with the active tool; start the group over at
  // its first member each time it reappears, rather than keeping a stop that
  // may not even render the same way (e.g. a wall placed while away).
  // A ring on an edge must not outlive the edge rects unmounting with it.
  useEffect(() => {
    if (edgesActive) setFocusedEdge(null);
    else setRing((current) => (current?.kind === "edge" ? null : current));
  }, [edgesActive]);

  // Our own focus ring, drawn only for keyboard focus. The browser's outline
  // is turned off on these rects: around an SVG <rect> it is clipped and
  // rounded and cannot be styled.
  const [ring, setRing] = useState<Target | null>(null);
  const [hover, setHover] = useState<Target | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const strokeRef = useRef<Stroke | null>(null);

  /** Closes the open stroke, if any. Safe to call more than once. */
  function finishStroke() {
    if (!strokeRef.current) return;
    strokeRef.current = null;
    document.documentElement.classList.remove("select-none");
    onStrokeEnd();
  }
  // Read by the window listener below, which is attached once.
  const finishStrokeRef = useRef(finishStroke);
  finishStrokeRef.current = finishStroke;

  // A release the board never hears (the window lost focus mid-swipe) must
  // not leave a stroke open, or undo would stay disabled indefinitely.
  useEffect(() => {
    const onBlur = () => finishStrokeRef.current();
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      finishStrokeRef.current();
    };
  }, []);

  function showRingIfKeyboard(
    event: FocusEvent<SVGRectElement> | KeyboardEvent<SVGRectElement>,
    target: Target,
  ) {
    let visible = false;
    try {
      visible = event.currentTarget.matches(":focus-visible");
    } catch {
      // A browser without :focus-visible gets no ring rather than an error.
    }
    setRing(visible ? target : null);
  }

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
    // Focus that a click gave becomes keyboard focus once a key is pressed.
    showRingIfKeyboard(event, { kind: "cell", at });
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
    if (next < 0 || next >= interiorEdges.length) return;
    edgeRefs.current.get(edgeKey(interiorEdges[next]!))?.focus();
  }

  function handleEdgeKeyDown(event: KeyboardEvent<SVGRectElement>, edge: Edge) {
    showRingIfKeyboard(event, { kind: "edge", edge });
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

  /** Client coordinates to board coordinates, in cell units. */
  function toBoard(event: PointerEvent<SVGSVGElement>) {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return { x: p.x / CELL_PX, y: p.y / CELL_PX };
  }

  /** What the active tool would act on at `p`. */
  function targetAt(p: { x: number; y: number }): Target | null {
    if (EDGE_TOOLS.has(tool)) {
      const edge = nearestInteriorEdge(p, painted);
      if (edge) return { kind: "edge", edge };
      // The eraser falls back to the square, to take a key off it.
      if (tool !== "erase") return null;
    }
    const at = cellUnder(p);
    return inFrame(at, FRAME) ? { kind: "cell", at } : null;
  }

  /** Feeds every target between two pointer samples to the stroke. */
  function strokeAlong(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    if (tool === "paint" || tool === "erase-cell") {
      for (const at of cellsBetween(cellUnder(from), cellUnder(to))) {
        if (inFrame(at, FRAME)) onStrokeCell(at);
      }
      return;
    }
    let previous = "";
    for (const sample of samplesBetween(from, to, SAMPLE_SPACING)) {
      const target = targetAt(sample);
      const key = targetKey(target);
      if (!target || key === previous) continue;
      previous = key;
      if (target.kind === "edge") onStrokeEdge(target.edge);
      else onStrokeCell(target.at);
    }
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || strokeRef.current) return;
    const p = toBoard(event);
    if (!p) return;
    setHover(null);

    if (!STROKE_TOOLS.has(tool)) {
      const target = targetAt(p);
      if (target?.kind === "edge") onEdge(target.edge);
      else if (target) onCell(target.at);
      return;
    }

    // Captured so the stroke keeps its moves and its release even when the
    // pointer leaves the board. The press itself has already been dispatched
    // to the rect under it, so the browser still focuses that rect.
    strokeRef.current = { pointerId: event.pointerId, last: p };
    // A swipe that strays off the board would otherwise select page text.
    // Not preventDefault on the press: that would stop the rect taking focus.
    document.documentElement.classList.add("select-none");
    try {
      svgRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the stroke still works while the pointer stays on
      // the board, and lostpointercapture/pointerup end it either way.
    }
    onStrokeBegin();
    strokeAlong(p, p);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const stroke = strokeRef.current;
    if (stroke?.pointerId === event.pointerId) {
      // No button down means the release was missed; the stroke is over.
      if (event.buttons === 0) {
        finishStroke();
        return;
      }
      const p = toBoard(event);
      if (!p) return;
      strokeAlong(stroke.last, p);
      stroke.last = p;
      return;
    }

    if (event.pointerType !== "mouse" || event.buttons !== 0) return;
    const p = toBoard(event);
    const next = p ? targetAt(p) : null;
    setHover((current) =>
      targetKey(current) === targetKey(next) ? current : next,
    );
  }

  function handlePointerEnd(event: PointerEvent<SVGSVGElement>) {
    if (strokeRef.current?.pointerId !== event.pointerId) return;
    finishStroke();
  }

  /**
   * What the active tool would do at the hovered target, drawn faintly.
   * Mouse only: on touch there is no hover, and the stroke is the feedback.
   */
  function renderHover(target: Target) {
    const common = {
      "data-hover": tool,
      "aria-hidden": true,
      pointerEvents: "none",
    } as const;

    if (target.kind === "edge") {
      const key = edgeKey(target.edge);
      const line = {
        ...common,
        "data-hover-edge": key,
        ...edgeLine(target.edge),
        strokeWidth: 4,
        strokeLinecap: "round",
      } as const;
      const existing = segmentAt.get(key);
      // A tap with the same segment removes it (spec §10.2), so the preview
      // says "remove", not "place". For a gate, "the same" is the same
      // number: gate 1 over gate 2 replaces it.
      const removes =
        (tool === "wall" && existing?.kind === "wall") ||
        (tool === "gate" &&
          existing?.kind === "gate" &&
          existing.gate === gate) ||
        (tool === "erase" && existing !== undefined);
      if (removes) {
        return (
          <line
            {...line}
            strokeWidth={6}
            opacity={0.6}
            className="stroke-danger"
          />
        );
      }
      if (tool === "wall") {
        return <line {...line} opacity={0.4} className="stroke-wall" />;
      }
      if (tool === "gate" && gate !== null) {
        return <GateSegment {...line} gate={gate} opacity={0.5} />;
      }
      return null;
    }

    const { at } = target;
    const key = cellKey(at);
    const isPainted = painted.has(key);
    const cell = { ...common, "data-hover-cell": key } as const;
    const icon = { ...cell, x: at.x, y: at.y, size: CELL_PX } as const;
    const square = {
      ...cell,
      x: at.x * CELL_PX,
      y: at.y * CELL_PX,
      width: CELL_PX,
      height: CELL_PX,
      opacity: 0.35,
    } as const;
    const cx = (at.x + 0.5) * CELL_PX;
    const cy = (at.y + 0.5) * CELL_PX;

    switch (tool) {
      case "paint":
        return !isPainted && canPaint ? (
          <rect {...square} className="fill-accent" />
        ) : null;
      case "erase-cell":
        return isPainted ? <rect {...square} className="fill-danger" /> : null;
      case "erase":
        return keyGateAt.has(key) ? (
          <circle
            {...cell}
            cx={cx}
            cy={cy}
            r={CELL_PX * 0.22}
            opacity={0.6}
            className="fill-danger"
          />
        ) : null;
      case "key":
        return isPainted && gate !== null ? (
          <KeyIcon {...icon} gate={gate} opacity={0.5} />
        ) : null;
      case "start":
        return isPainted ? <StartIcon {...icon} opacity={0.4} /> : null;
      case "treasure":
        return isPainted ? <TreasureIcon {...icon} opacity={0.4} /> : null;
      default:
        return null;
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
      ref={svgRef}
      data-board
      role="group"
      aria-label={t("boardLabel")}
      viewBox={`0 0 ${FRAME * CELL_PX} ${FRAME * CELL_PX}`}
      // touch-none: a swipe draws instead of scrolling the page. The board
      // already fits the width, so losing pinch-zoom on it costs little.
      className="border-border-strong h-auto w-full max-w-[700px] touch-none rounded border select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onPointerLeave={() => setHover(null)}
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
                ? "fill-cell-painted stroke-grid-line outline-none"
                : "fill-cell-void stroke-grid-line outline-none"
            }
            strokeWidth={1}
            onKeyDown={(event) => handleCellKeyDown(event, at)}
            onFocus={(event) => {
              setFocusedCell(at);
              showRingIfKeyboard(event, { kind: "cell", at });
            }}
            onBlur={() => setRing(null)}
          />
        );
      })}

      {draft.start && (
        <StartIcon
          data-start
          pointerEvents="none"
          x={draft.start.x}
          y={draft.start.y}
          size={CELL_PX}
        />
      )}

      {draft.treasure && (
        <TreasureIcon
          data-treasure
          pointerEvents="none"
          x={draft.treasure.x}
          y={draft.treasure.y}
          size={CELL_PX}
        />
      )}

      {draft.keys.map((key) => (
        <KeyIcon
          key={`key-${key.gate}`}
          data-key={key.gate}
          pointerEvents="none"
          x={key.x}
          y={key.y}
          size={CELL_PX}
          gate={key.gate}
        />
      ))}

      {/* The shape's own border: implicit walls (spec §2.3), never stored. */}
      {outlineEdges(draft.cells).map((edge) => (
        <line
          key={`outline-${edgeKey(edge)}`}
          data-outline={edgeKey(edge)}
          aria-hidden="true"
          pointerEvents="none"
          {...edgeLine(edge)}
          strokeWidth={4}
          strokeLinecap="round"
          className="stroke-wall"
        />
      ))}

      {draft.segments.map((segment) => {
        if (segment.kind === "gate") {
          return (
            <GateSegment
              key={`seg-${edgeKey(segment)}`}
              data-segment={edgeKey(segment)}
              data-gate={segment.gate}
              aria-hidden="true"
              pointerEvents="none"
              {...edgeLine(segment)}
              gate={segment.gate}
            />
          );
        }
        return (
          <line
            key={`seg-${edgeKey(segment)}`}
            data-segment={edgeKey(segment)}
            aria-hidden="true"
            pointerEvents="none"
            {...edgeLine(segment)}
            strokeWidth={4}
            strokeLinecap="round"
            className="stroke-wall"
          />
        );
      })}

      {edgesActive &&
        interiorEdges.map((edge, index) => {
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
              className="outline-none"
              onKeyDown={(event) => handleEdgeKeyDown(event, edge)}
              onFocus={(event) => {
                setFocusedEdge(key);
                showRingIfKeyboard(event, { kind: "edge", edge });
              }}
              onBlur={() => setRing(null)}
            />
          );
        })}

      {hover && !locked && renderHover(hover)}

      {ring?.kind === "cell" && (
        <rect
          data-focus-ring
          aria-hidden="true"
          pointerEvents="none"
          x={ring.at.x * CELL_PX + 2.5}
          y={ring.at.y * CELL_PX + 2.5}
          width={CELL_PX - 5}
          height={CELL_PX - 5}
          rx={3}
          fill="none"
          strokeWidth={3}
          className="stroke-accent"
        />
      )}
      {/* Hollow, so it reads apart from a wall in the same colour. */}
      {ring?.kind === "edge" && (
        <g data-focus-ring aria-hidden="true" pointerEvents="none">
          <line
            {...edgeLine(ring.edge)}
            strokeWidth={9}
            strokeLinecap="round"
            className="stroke-accent"
          />
          <line
            {...edgeLine(ring.edge)}
            strokeWidth={4}
            strokeLinecap="round"
            className="stroke-bg"
          />
        </g>
      )}
    </svg>
  );
}
