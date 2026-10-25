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
  brushCells,
  cellKey,
  edgeKey,
  edgeTouches,
  isInteriorEdge,
  outlineEdges,
  type BrushSize,
  type DraftMaze,
  type Edge,
  type Point,
  type Tool,
} from "~/maze";
import {
  capturePointer,
  cellsPerPixel,
  useWheelPan,
} from "~/components/board-pan";
import { cn } from "~/lib/cn";
import {
  GateSegment,
  KeyIcon,
  StartIcon,
  TreasureIcon,
} from "~/components/maze-icons";
import {
  clampCamera,
  follow,
  framePainted,
  type Bounds,
  type Camera,
} from "~/lib/camera";
import {
  cellUnder,
  cellsBetween,
  inFrame,
  nearestInteriorEdge,
  samplesBetween,
} from "./hit-test";

export const FRAME = MAX_BOUNDING_BOX;
/**
 * Squares along the shorter side of the board's window onto the frame on a
 * phone; the longer side shows as many more as its length allows. A frame
 * larger than the window is panned, not shrunk. Few enough that a square is
 * big enough to hit with a thumb.
 */
const VIEW = 12;
/**
 * The same on a desktop, zoomed further out: the board is much larger there,
 * so smaller squares are still easy to hit, and more of the maze is in view.
 */
const DESKTOP_VIEW = 24;
/** Tailwind's `lg`, where the editor puts its panel beside the board. */
const DESKTOP = "(min-width: 64rem)";
/** The window, in squares, before the board has been measured. */
const SQUARE_VIEW: View = { w: VIEW, h: VIEW };

/** The window's size in squares. */
type View = { w: number; h: number };

/**
 * The window that fills a space of `width` × `height` pixels, in square
 * cells, `short` of them along the shorter side.
 *
 * On a phone a space so long that its longer side would show more than the
 * whole frame gets larger cells instead, so the board still fills it, a
 * little under `short` across. On a desktop it keeps its zoom and shows the
 * frame with a margin of nothing either side, which the camera centres.
 */
function fitView(width: number, height: number, desktop: boolean): View {
  const short = desktop ? DESKTOP_VIEW : VIEW;
  const cell = Math.min(width, height) / short;
  const fill = desktop ? cell : Math.max(cell, Math.max(width, height) / FRAME);
  return { w: width / fill, h: height / fill };
}
export const CELL_PX = 40;
const FRAME_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: FRAME, maxY: FRAME };
/** Cells beyond the window still rendered, so an arrow key has a target. */
const OVERSCAN = 1;
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

/** A pan in progress: every pointer moving the board, by client position. */
type Pan = {
  points: Map<number, { x: number; y: number }>;
  /** Where the pointers' midpoint was last time the board moved. */
  last: { x: number; y: number };
};

function midpoint(points: Map<number, { x: number; y: number }>) {
  let x = 0;
  let y = 0;
  for (const p of points.values()) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.size, y: y / points.size };
}

/** Whether `at` is within the window, or no more than OVERSCAN outside it. */
function nearView(at: Point, cam: Camera, view: View): boolean {
  return (
    at.x >= Math.floor(cam.x) - OVERSCAN &&
    at.x < Math.ceil(cam.x + view.w) + OVERSCAN &&
    at.y >= Math.floor(cam.y) - OVERSCAN &&
    at.y < Math.ceil(cam.y + view.h) + OVERSCAN
  );
}

type Stroke = {
  pointerId: number;
  /** Last pointer position, in cell units. */
  last: { x: number; y: number };
  /** What the press landed on. */
  pressed: Target | null;
  /** Whether the pointer has since been over any other target. */
  strayed: boolean;
};

export type BoardProps = {
  draft: DraftMaze;
  /**
   * Changes whenever `draft` is replaced by one loaded from the server: the
   * camera then frames the new draft, as it framed the first on opening.
   */
  frame: number;
  tool: Tool;
  /**
   * Squares left in the budget. Paint previews no more than this many, in
   * `brushCells` order — the order `paintCells` paints them in.
   */
  paintsLeft: number;
  /** Squares per side that paint and erase-square cover. */
  brush: BrushSize;
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
  /** The stroke turned into a pan (a second finger): undo all of it. */
  onStrokeCancel: () => void;
  onStrokeCell: (at: Point) => void;
  onStrokeEdge: (edge: Edge) => void;
  /**
   * A stroke released on the square it was pressed on, never having left
   * it: a tap, not a drag. Called before `onStrokeEnd`, inside the stroke.
   */
  onStrokeTap: (at: Point) => void;
  onStrokeEnd: () => void;
};

/**
 * Renders every square near the window — `data-cell` for each, labelled
 * painted or void — so this is the author's own board. A run view needs a
 * sibling component fed only discovered cells and bumped segments; reusing
 * this one leaks void-vs-walled into the accessibility tree.
 *
 * The board is a window onto the FRAME-square frame, as large as the space
 * it is given allows, with VIEW squares along its shorter side. The
 * move tool, a two-finger drag, a middle or right drag and the wheel pan it;
 * keyboard focus brings its target into view.
 */
export function Board({
  draft,
  frame,
  tool,
  paintsLeft,
  brush,
  gate,
  locked,
  onCell,
  onEdge,
  onStrokeBegin,
  onStrokeCancel,
  onStrokeCell,
  onStrokeEdge,
  onStrokeTap,
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
  // The tab stop starts on the square in the middle of the opening window.
  const [focusedCell, setFocusedCell] = useState<Point>(() => {
    const opening = framePainted(draft.cells, SQUARE_VIEW, FRAME_BOUNDS);
    return { x: opening.x + VIEW / 2, y: opening.y + VIEW / 2 };
  });
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

  // The board fills the box it is laid out in, so its window is measured.
  const boxRef = useRef<HTMLDivElement>(null);
  /** The board's size in pixels, inside its border. */
  const [fit, setFit] = useState<{
    width: number;
    height: number;
    desktop: boolean;
  } | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      // Less the board's one-pixel border on each side.
      const width = box.clientWidth - 2;
      const height = box.clientHeight - 2;
      if (width <= 0 || height <= 0) return;
      const desktop = window.matchMedia(DESKTOP).matches;
      setFit((current) =>
        current?.width === width &&
        current.height === height &&
        current.desktop === desktop
          ? current
          : { width, height, desktop },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const view = fit ? fitView(fit.width, fit.height, fit.desktop) : SQUARE_VIEW;
  const viewRef = useRef(view);
  viewRef.current = view;

  const [cam, setCam] = useState<Camera>(() =>
    framePainted(draft.cells, SQUARE_VIEW, FRAME_BOUNDS),
  );
  // Read by the wheel listener, which is attached once.
  const camRef = useRef(cam);
  camRef.current = cam;
  const panRef = useRef<Pan | null>(null);
  const [panning, setPanning] = useState(false);
  /** Touch pointers down on the board, by client position. */
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());
  /**
   * A touch tap with a tap tool waits for its release, so a second finger
   * landing first turns it into a pan instead of a placement.
   */
  const tapRef = useRef<{ pointerId: number; target: Target } | null>(null);
  /** A target to focus once it renders: `c:` or `e:` plus its key. */
  const pendingFocusRef = useRef<string | null>(null);

  function moveCamera(next: Camera) {
    const clamped = clampCamera(next, viewRef.current, FRAME_BOUNDS);
    const current = camRef.current;
    if (clamped.x === current.x && clamped.y === current.y) return false;
    camRef.current = clamped;
    setCam(clamped);
    return true;
  }

  function reveal(at: Point) {
    moveCamera(follow(camRef.current, at, viewRef.current, OVERSCAN));
  }

  /**
   * Closes the open stroke, if any. Safe to call more than once. Only a real
   * release (`released`) can make it a tap: a cancelled or abandoned stroke
   * never is. A `cancelled` stroke is undone instead of ended.
   */
  function finishStroke(released = false, cancelled = false) {
    const stroke = strokeRef.current;
    if (!stroke) return;
    strokeRef.current = null;
    document.documentElement.classList.remove("select-none");
    if (cancelled) {
      onStrokeCancel();
      return;
    }
    if (released && !stroke.strayed && stroke.pressed?.kind === "cell") {
      onStrokeTap(stroke.pressed.at);
    }
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

  useWheelPan(svgRef, view.w, (dx, dy) => {
    // Not under a stroke: the board would move beneath the pointer, and the
    // stroke's next sample would join across everything in between. The
    // wheel is swallowed instead, since a page scroll would do the same.
    if (strokeRef.current) return true;
    const current = camRef.current;
    return moveCamera({ x: current.x + dx, y: current.y + dy });
  });

  // The camera frames the draft again once the board is first measured and
  // on every new `frame`; edits to the draft never move it. Any other resize
  // only keeps it inside the frame.
  const framed = useRef<number | null>(null);
  const measured = fit !== null;
  useEffect(() => {
    if (!measured) return;
    if (framed.current === frame) {
      moveCamera(camRef.current);
      return;
    }
    framed.current = frame;
    moveCamera(framePainted(draft.cells, view, FRAME_BOUNDS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, measured, view.w, view.h]);

  // A focus target that was off the board when an arrow key asked for it.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const refs = pending.startsWith("c:") ? cellRefs : edgeRefs;
    refs.current.get(pending.slice(2))?.focus({ preventScroll: true });
  });

  /** Shows the ring for keyboard focus only; says whether it did. */
  function showRingIfKeyboard(
    event: FocusEvent<SVGRectElement> | KeyboardEvent<SVGRectElement>,
    target: Target,
  ): boolean {
    let visible = false;
    try {
      visible = event.currentTarget.matches(":focus-visible");
    } catch {
      // A browser without :focus-visible gets no ring rather than an error.
    }
    setRing(visible ? target : null);
    return visible;
  }

  // The live tab stop is set from `onFocus`, not from here — that covers a
  // click or a programmatic focus the same way it covers an arrow move,
  // instead of three places independently deciding whose turn tabIndex={0}
  // is next.
  function moveCellFocus(dx: number, dy: number, from: Point) {
    const next = { x: from.x + dx, y: from.y + dy };
    if (next.x < 0 || next.x >= FRAME || next.y < 0 || next.y >= FRAME) return;
    const el = cellRefs.current.get(cellKey(next));
    if (el) {
      el.focus({ preventScroll: true });
      return;
    }
    // Not rendered: make it the stop, which renders it, then focus it.
    pendingFocusRef.current = `c:${cellKey(next)}`;
    setFocusedCell(next);
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
    const key = edgeKey(interiorEdges[next]!);
    const el = edgeRefs.current.get(key);
    if (el) {
      el.focus({ preventScroll: true });
      return;
    }
    pendingFocusRef.current = `e:${key}`;
    setFocusedEdge(key);
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
    if (tool === "move") return null;
    if (EDGE_TOOLS.has(tool)) {
      const edge = nearestInteriorEdge(p, painted);
      if (edge) return { kind: "edge", edge };
      // The eraser falls back to the square, to clear everything on it.
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

  /** Starts a pan, or adds a pointer to the one in progress. */
  function beginPan(pointerId: number, at: { x: number; y: number }) {
    const pan: Pan = panRef.current ?? { points: new Map(), last: at };
    pan.points.set(pointerId, at);
    // Re-based on every new pointer, so a second finger landing is no jump.
    pan.last = midpoint(pan.points);
    panRef.current = pan;
    setPanning(true);
    setHover(null);
    document.documentElement.classList.add("select-none");
    capturePointer(svgRef.current, pointerId);
  }

  function movePan(pointerId: number, at: { x: number; y: number }) {
    const pan = panRef.current;
    if (!pan?.points.has(pointerId)) return false;
    pan.points.set(pointerId, at);
    const mid = midpoint(pan.points);
    const scale = cellsPerPixel(svgRef.current, CELL_PX);
    const current = camRef.current;
    moveCamera({
      x: current.x - (mid.x - pan.last.x) * scale,
      y: current.y - (mid.y - pan.last.y) * scale,
    });
    pan.last = mid;
    return true;
  }

  function endPan(pointerId: number) {
    const pan = panRef.current;
    if (!pan?.points.delete(pointerId)) return;
    if (pan.points.size > 0) {
      pan.last = midpoint(pan.points);
      return;
    }
    panRef.current = null;
    setPanning(false);
    document.documentElement.classList.remove("select-none");
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    const client = { x: event.clientX, y: event.clientY };
    if (event.pointerType === "touch") {
      touchesRef.current.set(event.pointerId, client);
      // A second finger: whatever the first began becomes a two-finger pan.
      if (touchesRef.current.size > 1) {
        tapRef.current = null;
        finishStroke(false, true);
        for (const [id, at] of touchesRef.current) beginPan(id, at);
        return;
      }
    }
    if (panRef.current) return;

    // The middle and right buttons pan whatever the tool; so does any press
    // with the move tool.
    if (event.button === 1 || event.button === 2 || tool === "move") {
      if (event.button === 1) event.preventDefault(); // no autoscroll
      beginPan(event.pointerId, client);
      return;
    }

    if (event.button !== 0 || strokeRef.current) return;
    const p = toBoard(event);
    if (!p) return;
    setHover(null);

    if (!STROKE_TOOLS.has(tool)) {
      const target = targetAt(p);
      if (!target) return;
      if (event.pointerType === "touch") {
        tapRef.current = { pointerId: event.pointerId, target };
        return;
      }
      if (target.kind === "edge") onEdge(target.edge);
      else onCell(target.at);
      return;
    }

    // Captured so the stroke keeps its moves and its release even when the
    // pointer leaves the board. The press itself has already been dispatched
    // to the rect under it, so the browser still focuses that rect.
    strokeRef.current = {
      pointerId: event.pointerId,
      last: p,
      pressed: targetAt(p),
      strayed: false,
    };
    // A swipe that strays off the board would otherwise select page text.
    // Not preventDefault on the press: that would stop the rect taking focus.
    document.documentElement.classList.add("select-none");
    capturePointer(svgRef.current, event.pointerId);
    onStrokeBegin();
    strokeAlong(p, p);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const client = { x: event.clientX, y: event.clientY };
    if (touchesRef.current.has(event.pointerId)) {
      touchesRef.current.set(event.pointerId, client);
    }
    if (movePan(event.pointerId, client)) return;

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
      if (targetKey(targetAt(p)) !== targetKey(stroke.pressed)) {
        stroke.strayed = true;
      }
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
    touchesRef.current.delete(event.pointerId);
    endPan(event.pointerId);

    const tap = tapRef.current;
    if (tap?.pointerId === event.pointerId) {
      tapRef.current = null;
      // Only a release on the target it pressed is a tap.
      const p = event.type === "pointerup" ? toBoard(event) : null;
      if (p && targetKey(targetAt(p)) === targetKey(tap.target)) {
        if (tap.target.kind === "edge") onEdge(tap.target.edge);
        else onCell(tap.target.at);
      }
    }

    if (strokeRef.current?.pointerId !== event.pointerId) return;
    finishStroke(event.type === "pointerup");
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
    const cx = (at.x + 0.5) * CELL_PX;
    const cy = (at.y + 0.5) * CELL_PX;

    // Every square of the brush the stamp would change, so a 2×2 previews
    // as a block — and only the part of it that would actually change.
    const stamp = (
      show: (key: string) => boolean,
      className: string,
      limit = Infinity,
    ) => {
      const squares = brushCells(at, brush)
        .filter((p) => show(cellKey(p)))
        .slice(0, limit);
      if (squares.length === 0) return null;
      return (
        <g {...cell}>
          {squares.map((p) => (
            <rect
              key={cellKey(p)}
              x={p.x * CELL_PX}
              y={p.y * CELL_PX}
              width={CELL_PX}
              height={CELL_PX}
              opacity={0.35}
              className={className}
            />
          ))}
        </g>
      );
    };

    switch (tool) {
      case "paint":
        return stamp((k) => !painted.has(k), "fill-accent", paintsLeft);
      case "erase-cell":
        return stamp((k) => painted.has(k), "fill-danger");
      case "erase": {
        // Everything `clearCell` would take: what sits on the square, and
        // every wall and gate on its sides.
        const holdsSomething =
          keyGateAt.has(key) ||
          (draft.start !== null && cellKey(draft.start) === key) ||
          (draft.treasure !== null && cellKey(draft.treasure) === key);
        const sides = draft.segments.filter((s) => edgeTouches(s, at));
        if (!holdsSomething && sides.length === 0) return null;
        return (
          <g {...cell}>
            {holdsSomething && (
              <circle
                cx={cx}
                cy={cy}
                r={CELL_PX * 0.22}
                opacity={0.6}
                className="fill-danger"
              />
            )}
            {sides.map((s) => (
              <line
                key={edgeKey(s)}
                {...edgeLine(s)}
                strokeWidth={6}
                strokeLinecap="round"
                opacity={0.6}
                className="stroke-danger"
              />
            ))}
          </g>
        );
      }
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
    // The space the board fills. On a phone the full width, and as tall as
    // that or the screen, whichever is less: a square upright, a wide strip
    // on its side. On a desktop everything beside the panel and below the
    // title, capped so a very wide or very tall monitor does not get a
    // giant board.
    <div
      ref={boxRef}
      className="h-[min(calc(100vw-2rem),calc(100dvh-2rem))] w-full min-w-0 lg:h-[min(calc(100dvh-11rem),60rem)] lg:max-w-[100rem] lg:flex-1"
    >
      <svg
        ref={svgRef}
        data-board
        role="group"
        aria-label={t("boardLabel")}
        data-camera={`${cam.x},${cam.y}`}
        data-view={`${view.w},${view.h}`}
        viewBox={`${cam.x * CELL_PX} ${cam.y * CELL_PX} ${view.w * CELL_PX} ${view.h * CELL_PX}`}
        // touch-none: a swipe draws instead of scrolling the page. The board
        // already fits the width, so losing pinch-zoom on it costs little.
        className={cn(
          "border-border-strong block h-full w-full touch-none rounded border select-none",
          panning ? "cursor-grabbing" : tool === "move" && "cursor-grab",
        )}
        onContextMenu={(event) => event.preventDefault()}
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
          // The tab stop always renders, wherever the window has gone.
          if (!focused && !nearView(at, cam, view)) return null;
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
                if (showRingIfKeyboard(event, { kind: "cell", at })) reveal(at);
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
            if (!focused && !nearView(edge, cam, view)) return null;
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
                  if (showRingIfKeyboard(event, { kind: "edge", edge })) {
                    reveal(edge);
                  }
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
    </div>
  );
}
