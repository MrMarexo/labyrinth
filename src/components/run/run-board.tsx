"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { CELL_PX } from "~/components/editor/board";
import { gateColour } from "~/components/editor/gate-colours";
import { KeyIcon, StartIcon, TreasureIcon } from "~/components/maze-icons";
import { useReducedMotion } from "~/components/use-reduced-motion";
import {
  cellKey,
  edgeBetween,
  edgeKey,
  step,
  type Direction,
  type DiscoveredMap,
  type Edge,
  type Point,
  type RevealedSegment,
} from "~/maze";

export type Bump = { segment: RevealedSegment; id: number };

export type RunBoardProps = {
  map: DiscoveredMap;
  at: Point;
  heldKeys: readonly number[];
  bump: Bump | null;
  /** The move waiting on the server, which the runner leans toward. */
  lean?: Direction | null;
};

/** The board never shows less than this many cells across (spec §10.3). */
const MIN_SPAN = 7;
/** How far the runner leans toward an unanswered move, in cells. */
const LEAN = 0.35;
const LEAN_MS = 90;
const SETTLE_MS = 120;
const PULSE_MS = 200;
const ZOOM_MS = 200;
/** Something already found: a key picked up, the treasure reached. */
const TAKEN_OPACITY = 0.15;

const LEAN_VECTOR: Record<Direction, Point> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

/** {o:"H",x,y} sits below (x,y); {o:"V",x,y} sits to its right. */
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
 * Edges between two discovered cells that the runner has neither bumped nor
 * walked through: could be open, could be a wall. Derived from the map
 * alone, so drawing them discloses nothing.
 */
export function untestedEdges(map: DiscoveredMap): Edge[] {
  const cells = new Set(map.cells.map(cellKey));
  const known = new Set(
    [...map.segments, ...(map.passages ?? [])].map(edgeKey),
  );
  const out: Edge[] = [];
  for (const c of map.cells) {
    for (const dir of ["E", "S"] as const) {
      const edge = edgeBetween(c, dir);
      if (cells.has(cellKey(step(c, dir))) && !known.has(edgeKey(edge))) {
        out.push(edge);
      }
    }
  }
  return out;
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * At least MIN_SPAN cells each way, centred on the runner, grown to fit
 * everything discovered with a cell of padding, then squared off.
 */
function boardBox(map: DiscoveredMap, at: Point): Box {
  const half = Math.floor(MIN_SPAN / 2);
  let minX = at.x - half;
  let maxX = at.x + half;
  let minY = at.y - half;
  let maxY = at.y + half;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x - 1);
    maxX = Math.max(maxX, x + 1);
    minY = Math.min(minY, y - 1);
    maxY = Math.max(maxY, y + 1);
  };
  for (const c of map.cells) include(c.x, c.y);
  for (const e of [...map.segments, ...(map.passages ?? [])]) {
    include(e.x, e.y);
    include(e.o === "H" ? e.x : e.x + 1, e.o === "H" ? e.y + 1 : e.y);
  }
  // Square, so the board's on-screen size never changes as it grows: on a
  // phone the d-pad below it must not move under the thumb.
  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  if (spanX < spanY) {
    minX -= Math.floor((spanY - spanX) / 2);
    maxX += Math.ceil((spanY - spanX) / 2);
  } else if (spanY < spanX) {
    minY -= Math.floor((spanX - spanY) / 2);
    maxY += Math.ceil((spanX - spanY) / 2);
  }
  return {
    x: minX * CELL_PX,
    y: minY * CELL_PX,
    w: (maxX - minX + 1) * CELL_PX,
    h: (maxY - minY + 1) * CELL_PX,
  };
}

/** Eases the viewBox toward `target` over ZOOM_MS, or jumps when reduced. */
function useEasedBox(target: Box, reduced: boolean): Box {
  const [box, setBox] = useState(target);
  const shown = useRef(target);
  const key = `${target.x},${target.y},${target.w},${target.h}`;

  useEffect(() => {
    const from = shown.current;
    if (reduced) {
      shown.current = target;
      setBox(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ZOOM_MS);
      const e = 1 - (1 - t) ** 3;
      const next = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      };
      shown.current = next;
      setBox(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `key` stands for `target`, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);

  return box;
}

/** True for PULSE_MS after each new bump, so the class never lingers. */
function usePulse(id: number | null): boolean {
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (id === null) return;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), PULSE_MS + 20);
    return () => clearTimeout(timer);
  }, [id]);
  return pulsing;
}

/**
 * The runner's own view: only discovered cells and segments are drawn, and
 * everything is hidden from the accessibility tree — the view's live region
 * says what happened. The editor board cannot be reused, since it renders
 * every square (see `editor/board.tsx`).
 */
export function RunBoard({ map, at, heldKeys, bump, lean }: RunBoardProps) {
  const t = useTranslations("run");
  const reduced = useReducedMotion();
  const box = useEasedBox(boardBox(map, at), reduced);
  const pulsing = usePulse(bump?.id ?? null);

  const drawSegment = (
    segment: RevealedSegment,
    key: string,
    extra: { strokeWidth: number; hook?: boolean },
  ) => {
    const held = segment.kind === "gate" && heldKeys.includes(segment.gate);
    return (
      <line
        key={key}
        data-run-segment={extra.hook ? edgeKey(segment) : undefined}
        aria-hidden="true"
        {...edgeLine(segment)}
        strokeWidth={extra.strokeWidth}
        strokeLinecap="round"
        strokeDasharray={held ? "6 4" : undefined}
        className={segment.kind === "wall" ? "stroke-wall" : undefined}
        style={
          segment.kind === "gate"
            ? { stroke: gateColour(segment.gate) }
            : undefined
        }
      />
    );
  };

  // The lean is cosmetic: `data-runner-at` is always the logical position.
  const offset = lean && !reduced ? LEAN_VECTOR[lean] : { x: 0, y: 0 };
  const runnerX = (at.x + offset.x * LEAN) * CELL_PX;
  const runnerY = (at.y + offset.y * LEAN) * CELL_PX;

  return (
    <svg
      data-run-board
      role="img"
      aria-label={t("boardLabel")}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      className="border-border-strong aspect-square h-auto w-full max-w-[700px] rounded border"
    >
      <rect
        aria-hidden="true"
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        className="fill-cell-void"
      />
      {map.cells.map((c) => (
        <g key={cellKey(c)} aria-hidden="true">
          <rect
            data-run-cell={`${c.x},${c.y}`}
            x={c.x * CELL_PX}
            y={c.y * CELL_PX}
            width={CELL_PX}
            height={CELL_PX}
            className="fill-cell-painted stroke-grid-line"
          />
          {/* Standing on a cell is what reveals it, so a drawn treasure has
              been reached and a drawn key has been picked up. */}
          {c.treasure && (
            <TreasureIcon
              x={c.x}
              y={c.y}
              size={CELL_PX}
              opacity={TAKEN_OPACITY}
              data-treasure-reached=""
            />
          )}
          {c.key !== undefined && (
            <KeyIcon
              x={c.x}
              y={c.y}
              size={CELL_PX}
              gate={c.key}
              opacity={TAKEN_OPACITY}
              data-collected-key={c.key}
            />
          )}
        </g>
      ))}

      {/* The run starts at the origin: discovered coordinates are relative. */}
      <StartIcon x={0} y={0} size={CELL_PX} />

      {untestedEdges(map).map((e) => (
        <line
          key={`untested-${edgeKey(e)}`}
          data-untested={edgeKey(e)}
          aria-hidden="true"
          {...edgeLine(e)}
          strokeWidth={2}
          strokeDasharray="4 4"
          opacity={0.3}
          className="stroke-wall"
        />
      ))}

      {map.segments.map((s) =>
        drawSegment(s, `seg-${edgeKey(s)}`, { strokeWidth: 4, hook: true }),
      )}

      {bump && drawSegment(bump.segment, "bump", { strokeWidth: 6 })}

      <g
        aria-hidden="true"
        style={{
          transform: `translate(${runnerX}px, ${runnerY}px)`,
          transition: reduced
            ? "none"
            : `transform ${lean ? LEAN_MS : SETTLE_MS}ms ease-out`,
        }}
      >
        <g
          // A new key per bump restarts the animation on a quick second bump.
          key={bump?.id ?? "still"}
          data-bump-pulse={pulsing ? "" : undefined}
          className={pulsing ? "motion-safe:animate-bump-pulse" : undefined}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <circle
            data-runner-at={`${at.x},${at.y}`}
            cx={CELL_PX / 2}
            cy={CELL_PX / 2}
            r={CELL_PX * 0.25}
            // The outline keeps the runner visible on the start square, whose
            // marker is the same accent colour.
            strokeWidth={3}
            className="fill-accent stroke-bg"
          />
        </g>
      </g>
    </svg>
  );
}
