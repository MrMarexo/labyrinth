"use client";

import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

import { CELL_PX } from "~/components/editor/board";
import {
  GateSegment,
  KeyIcon,
  RunnerIcon,
  StartIcon,
  TreasureIcon,
} from "~/components/maze-icons";
import {
  pixelWalls,
  TILE_CHIP,
  TILE_GAP,
  tilesPath,
  WALL_WIDTH,
} from "~/components/pixel-geometry";
import { useReducedMotion } from "~/components/use-reduced-motion";
import {
  capturePointer,
  cellsPerPixel,
  useWheelPan,
} from "~/components/board-pan";
import {
  centreOn,
  clampCamera,
  follow,
  type Bounds,
  type Camera,
} from "~/lib/camera";
import { cn } from "~/lib/cn";
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
/**
 * Nor more: past this the board stops zooming out and becomes a camera that
 * follows the runner.
 */
const MAX_SPAN = 16;
/** How near an edge of the camera, in cells, the runner may come. */
const FOLLOW_MARGIN = 2;
/**
 * How far the runner steps toward an unanswered move, in cells: up to where
 * a wall would stand. The answer then carries it on into the cell or bounces
 * it back, so a step reads as one motion rather than a wait and a jump. The
 * same for every move, so it discloses nothing (invariant 6).
 */
const LEAN = 0.5;
const LEAN_MS = 100;
const SETTLE_MS = 120;
const PULSE_MS = 200;
const ZOOM_MS = 200;
/** Something already found or left behind: a key picked up, the treasure
 * reached, the start door. */
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
 * everything discovered with a cell of padding. `max` is exclusive.
 */
function discoveredBounds(map: DiscoveredMap, at: Point): Bounds {
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
  return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
}

/** `bounds`, squared off. */
function fitBox({ minX, minY, maxX, maxY }: Bounds): Box {
  // Square, so the board's on-screen size never changes as it grows: on a
  // phone the d-pad below it must not move under the thumb.
  const span = Math.max(maxX - minX, maxY - minY);
  return {
    x: (minX - Math.floor((span - (maxX - minX)) / 2)) * CELL_PX,
    y: (minY - Math.floor((span - (maxY - minY)) / 2)) * CELL_PX,
    w: span * CELL_PX,
    h: span * CELL_PX,
  };
}

function boxString(box: Box): string {
  return `${box.x} ${box.y} ${box.w} ${box.h}`;
}

/**
 * Keeps the SVG's viewBox on `target`, eased over ZOOM_MS, or at once when
 * reduced. Written straight to the element, so no frame of the easing and no
 * pan renders anything. Returns the box to render with, and `jump`, which
 * moves the viewBox at once (a pan, which must track the pointer).
 */
function useViewBox(
  svgRef: RefObject<SVGSVGElement | null>,
  target: Box,
  reduced: boolean,
) {
  const shown = useRef(target);
  const frame = useRef(0);
  const key = boxString(target);

  function write(box: Box) {
    shown.current = box;
    svgRef.current?.setAttribute("viewBox", boxString(box));
  }

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    const from = shown.current;
    if (reduced) {
      write(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ZOOM_MS);
      const e = 1 - (1 - t) ** 3;
      write({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      });
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
    // `key` stands for `target`, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);

  return {
    box: shown.current,
    jump(box: Box) {
      cancelAnimationFrame(frame.current);
      write(box);
    },
  };
}

function cameraBox(cam: Camera): Box {
  return {
    x: cam.x * CELL_PX,
    y: cam.y * CELL_PX,
    w: MAX_SPAN * CELL_PX,
    h: MAX_SPAN * CELL_PX,
  };
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
  const svgRef = useRef<SVGSVGElement>(null);

  // Once what is discovered outgrows MAX_SPAN, the board is a camera over it.
  // A pan is the viewer's own; the runner's next move brings the camera back
  // (`follow` centres a runner who is out of view). The camera never shows
  // more than the discovered bounds, so it gives nothing away either.
  const bounds = discoveredBounds(map, at);
  const capped =
    Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) > MAX_SPAN;
  // `cam` is the camera as last committed; a pan in progress moves the
  // board without it and commits once it settles, so it renders nothing.
  const [cam, setCam] = useState<Camera | null>(null);
  const shown = clampCamera(cam ?? centreOn(at, MAX_SPAN), MAX_SPAN, bounds);
  // Where the camera is now. A pan starts each step from here, since several
  // pointer or wheel events can arrive between renders; a render only resets
  // it when no pan is waiting to be committed.
  const liveRef = useRef(shown);
  const uncommitted = useRef(false);
  if (!uncommitted.current) liveRef.current = shown;
  const commitTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(commitTimer.current), []);

  function commit() {
    window.clearTimeout(commitTimer.current);
    uncommitted.current = false;
    setCam(liveRef.current);
  }

  const atKey = cellKey(at);
  useEffect(() => {
    window.clearTimeout(commitTimer.current);
    uncommitted.current = false;
    if (!capped) {
      setCam(null);
      return;
    }
    // From wherever the viewer left it, panned or not.
    const from = clampCamera(liveRef.current, MAX_SPAN, bounds);
    setCam(follow(from, at, MAX_SPAN, FOLLOW_MARGIN));
    // `atKey` stands for `at`; `bounds` only ever grows with a move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atKey, capped]);

  const view = useViewBox(
    svgRef,
    capped ? cameraBox(shown) : fitBox(bounds),
    reduced,
  );

  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);

  /** Moves the camera by a delta in cells, on the element only. */
  function panBy(dx: number, dy: number): boolean {
    if (!capped) return false;
    const from = liveRef.current;
    const next = clampCamera(
      { x: from.x + dx, y: from.y + dy },
      MAX_SPAN,
      bounds,
    );
    if (next.x === from.x && next.y === from.y) return false;
    liveRef.current = next;
    uncommitted.current = true;
    view.jump(cameraBox(next));
    if (svgRef.current) svgRef.current.dataset.camera = `${next.x},${next.y}`;
    return true;
  }
  useWheelPan(svgRef, MAX_SPAN, (dx, dy) => {
    const moved = panBy(dx, dy);
    // The wheel has no release: commit once it has been still a moment.
    if (moved) {
      window.clearTimeout(commitTimer.current);
      commitTimer.current = window.setTimeout(commit, 150);
    }
    return moved;
  });

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!capped || panRef.current) return;
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    setPanning(true);
    capturePointer(svgRef.current, event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const pan = panRef.current;
    if (pan?.pointerId !== event.pointerId) return;
    const scale = cellsPerPixel(svgRef.current, CELL_PX);
    if (!scale) return;
    panBy(-(event.clientX - pan.x) * scale, -(event.clientY - pan.y) * scale);
    pan.x = event.clientX;
    pan.y = event.clientY;
  }

  function handlePointerEnd(event: PointerEvent<SVGSVGElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    if (uncommitted.current) commit();
  }

  const pulsing = usePulse(bump?.id ?? null);

  const walls = pixelWalls(
    map.segments.filter((s) => s.kind !== "gate"),
    CELL_PX,
    WALL_WIDTH,
  );

  const drawSegment = (
    segment: RevealedSegment,
    key: string,
    extra: { strokeWidth: number; hook?: boolean },
  ) => {
    if (segment.kind === "gate") {
      return (
        <GateSegment
          key={key}
          data-run-segment={extra.hook ? edgeKey(segment) : undefined}
          aria-hidden="true"
          {...edgeLine(segment)}
          gate={segment.gate}
          strokeWidth={extra.strokeWidth}
          strokeDasharray={heldKeys.includes(segment.gate) ? "6 4" : undefined}
        />
      );
    }
    return (
      <line
        key={key}
        data-run-segment={extra.hook ? edgeKey(segment) : undefined}
        aria-hidden="true"
        // The bump's thick copy stays straight: it swells the whole wall.
        {...(extra.hook ? walls.line(segment) : edgeLine(segment))}
        strokeWidth={extra.strokeWidth}
        strokeLinecap="square"
        className="stroke-wall"
      />
    );
  };

  // The lean is cosmetic: `data-runner-at` is always the logical position.
  const offset = lean && !reduced ? LEAN_VECTOR[lean] : { x: 0, y: 0 };
  const runnerX = (at.x + offset.x * LEAN) * CELL_PX;
  const runnerY = (at.y + offset.y * LEAN) * CELL_PX;

  return (
    <svg
      ref={svgRef}
      data-run-board
      data-camera={capped ? `${shown.x},${shown.y}` : undefined}
      role="img"
      aria-label={t("boardLabel")}
      viewBox={boxString(view.box)}
      preserveAspectRatio="xMidYMid meet"
      // A camera pans with a drag, so then a swipe on it must not scroll.
      className={cn(
        // The void is the element's own background, not a rect in the
        // drawing: it then covers whatever the viewBox shows, mid-pan too.
        "border-border-strong bg-cell-void pixel aspect-square h-auto w-full max-w-[700px] border",
        capped && "touch-none select-none",
        capped && (panning ? "cursor-grabbing" : "cursor-grab"),
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
    >
      {map.cells.map((c) => (
        <g key={cellKey(c)} aria-hidden="true">
          <rect
            data-run-cell={`${c.x},${c.y}`}
            x={c.x * CELL_PX}
            y={c.y * CELL_PX}
            width={CELL_PX}
            height={CELL_PX}
            className="fill-grid-line"
          />
          <path
            d={tilesPath([c], CELL_PX, TILE_GAP, TILE_CHIP)}
            className="fill-cell-painted"
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

      {/* The run starts at the origin: discovered coordinates are relative.
          Faint like the taken markers, so the runner reads on top of it. */}
      <StartIcon
        x={0}
        y={0}
        size={CELL_PX}
        opacity={TAKEN_OPACITY}
        data-run-start=""
      />

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
        drawSegment(s, `seg-${edgeKey(s)}`, {
          strokeWidth: WALL_WIDTH,
          hook: true,
        }),
      )}
      {walls.corners.map((pixel) => (
        <rect
          key={`corner-${pixel.x},${pixel.y}`}
          aria-hidden="true"
          {...pixel}
          className="fill-wall"
        />
      ))}

      {/* Only while pulsing: left on, the thick copy would keep the wall
          swollen until the next bump. */}
      {bump && pulsing && (
        <g
          key={bump.id}
          data-bump-wall=""
          aria-hidden="true"
          className="motion-safe:animate-bump-wall"
        >
          {drawSegment(bump.segment, "bump", { strokeWidth: 6 })}
        </g>
      )}

      <g
        aria-hidden="true"
        style={{
          transform: `translate(${runnerX}px, ${runnerY}px)`,
          transition: reduced
            ? "none"
            : lean
              ? // Easing out, so a slow answer leaves the runner resting
                // on the wall line rather than stopping hard against it.
                `transform ${LEAN_MS}ms ease-out`
              : `transform ${SETTLE_MS}ms ease-out`,
        }}
      >
        <g
          // A new key per bump restarts the animation on a quick second bump.
          key={bump?.id ?? "still"}
          data-bump-pulse={pulsing ? "" : undefined}
          className={pulsing ? "motion-safe:animate-bump-pulse" : undefined}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <RunnerIcon
            data-runner-at={`${at.x},${at.y}`}
            x={0}
            y={0}
            size={CELL_PX}
          />
        </g>
      </g>
    </svg>
  );
}
