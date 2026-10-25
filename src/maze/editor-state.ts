import type { DraftMaze } from "./draft";
import { MAX_BOUNDING_BOX, type Point } from "./format";
import {
  cellKey,
  edgeKey,
  edgeTouches,
  isInteriorEdge,
  type Edge,
} from "./geometry";

export type Tool =
  /** Pans the board; draws nothing. */
  | "move"
  | "paint"
  | "erase-cell"
  | "wall"
  | "gate"
  | "key"
  | "start"
  | "treasure"
  | "erase";

/** Squares per side that one paint or erase touches. */
export const BRUSH_SIZES = [1, 2] as const;
export type BrushSize = (typeof BRUSH_SIZES)[number];

/**
 * The squares a brush of `size` covers when it lands on `at`: `at` and the
 * squares right of and below it, shifted back so the block stays whole at
 * the frame's far edges.
 */
export function brushCells(at: Point, size: BrushSize): Point[] {
  const x0 = Math.min(at.x, MAX_BOUNDING_BOX - size);
  const y0 = Math.min(at.y, MAX_BOUNDING_BOX - size);
  const cells: Point[] = [];
  for (let y = y0; y < y0 + size; y += 1) {
    for (let x = x0; x < x0 + size; x += 1) cells.push({ x, y });
  }
  return cells;
}

export type EditorState = {
  draft: DraftMaze;
  past: DraftMaze[];
  future: DraftMaze[];
  /**
   * The draft as it was when the current stroke began, or null outside a
   * stroke. Edits inside a stroke change `draft` without touching the
   * history; `endStroke` then records the whole stroke as one undo step.
   */
  strokeBase: DraftMaze | null;
};

export type EditorAction =
  /** `limit` is the square budget: no new square once it is reached. */
  | { type: "paintCell"; at: Point; limit?: number }
  | { type: "eraseCell"; at: Point }
  /** One brush stamp: every square in `cells`, as a single edit. */
  | { type: "paintCells"; cells: Point[]; limit?: number }
  | { type: "eraseCells"; cells: Point[] }
  | { type: "placeSegment"; edge: Edge; kind: "wall" }
  /**
   * Places gate `gate`, moving it if it is already elsewhere. `gateCount` is
   * the maze's gate budget: an id outside 1..gateCount is refused.
   */
  | {
      type: "placeSegment";
      edge: Edge;
      kind: "gate";
      gate: number;
      gateCount: number;
    }
  | { type: "removeSegment"; edge: Edge }
  /** Like `placeSegment` with a wall, but never toggles one off. */
  | { type: "setWall"; edge: Edge }
  /** Refused for an id outside 1..gateCount, like a gate. */
  | { type: "placeKey"; at: Point; gate: number; gateCount: number }
  /**
   * The eraser on a square: everything on it and on its four sides — key,
   * start, treasure, walls, gates — but never the square itself.
   */
  | { type: "clearCell"; at: Point }
  /** The eraser dragged over a square: its key, start or treasure only. */
  | { type: "clearItems"; at: Point }
  | { type: "placeStart"; at: Point }
  | { type: "placeTreasure"; at: Point }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "beginStroke" }
  | { type: "endStroke" }
  /** Abandons the open stroke: the draft goes back to how it began. */
  | { type: "cancelStroke" }
  /**
   * Starts over from `draft` as if it had just been opened: no history, and
   * the same reference-preserving cleanup as `initialEditorState`.
   */
  | { type: "load"; draft: DraftMaze };

export function initialEditorState(draft: DraftMaze): EditorState {
  return {
    draft: dropSegmentsOutsideShape(draft),
    past: [],
    future: [],
    strokeBase: null,
  };
}

/**
 * The editor used to accept a wall or gate on any edge, including one with a
 * void square on one side. The validator rejects those (`segmentOutsideShape`)
 * and the board no longer offers them as targets, so a draft holding one
 * could never be fixed. They are dropped on load. A dropped gate's key
 * stays, as it does whenever a gate goes: the author places the gate again
 * or removes the key.
 *
 * Returns `draft` itself when nothing is dropped. The editor's autosave skips
 * a draft that is reference-equal to the one it loaded, so a clean draft is
 * never written back, while a cleaned one is saved once, persisting the fix.
 * It is not an undo step: there is no history before the load.
 */
function dropSegmentsOutsideShape(draft: DraftMaze): DraftMaze {
  const painted = new Set(draft.cells.map(cellKey));
  const segments = draft.segments.filter((s) => isInteriorEdge(s, painted));
  if (segments.length === draft.segments.length) return draft;
  return { ...draft, segments };
}

export function cellsUsed(draft: DraftMaze): number {
  return draft.cells.length;
}

export function gatesPlaced(draft: DraftMaze): number {
  return draft.segments.filter((s) => s.kind === "gate").length;
}

export function keysPlaced(draft: DraftMaze): number {
  return draft.keys.length;
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  if (action.type === "load") return initialEditorState(action.draft);

  if (action.type === "beginStroke") {
    if (state.strokeBase !== null) return state;
    return { ...state, strokeBase: state.draft };
  }

  if (action.type === "endStroke") {
    const base = state.strokeBase;
    if (base === null) return state;
    if (state.draft === base) return { ...state, strokeBase: null };
    return {
      ...state,
      past: [...state.past, base],
      future: [],
      strokeBase: null,
    };
  }

  if (action.type === "cancelStroke") {
    const base = state.strokeBase;
    if (base === null) return state;
    return { ...state, draft: base, strokeBase: null };
  }

  // History can't move under a stroke that is still being drawn.
  if (
    (action.type === "undo" || action.type === "redo") &&
    state.strokeBase !== null
  ) {
    return state;
  }

  if (action.type === "undo") {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return {
      ...state,
      draft: previous,
      past: state.past.slice(0, -1),
      future: [state.draft, ...state.future],
    };
  }

  if (action.type === "redo") {
    const next = state.future[0];
    if (!next) return state;
    return {
      ...state,
      draft: next,
      past: [...state.past, state.draft],
      future: state.future.slice(1),
    };
  }

  const draft = applyEdit(state.draft, action);

  // An edit that changed nothing must not cost an undo step: dragging across a
  // square that is already painted would otherwise fill the stack with no-ops.
  if (draft === state.draft) return state;

  if (state.strokeBase !== null) return { ...state, draft };

  return { ...state, draft, past: [...state.past, state.draft], future: [] };
}

function applyEdit(draft: DraftMaze, action: EditorAction): DraftMaze {
  switch (action.type) {
    case "paintCells":
      return action.cells.reduce(
        (d, at) => applyEdit(d, { type: "paintCell", at, limit: action.limit }),
        draft,
      );

    case "eraseCells":
      return action.cells.reduce(
        (d, at) => applyEdit(d, { type: "eraseCell", at }),
        draft,
      );

    case "paintCell": {
      if (draft.cells.some((c) => cellKey(c) === cellKey(action.at)))
        return draft;
      if (action.limit !== undefined && draft.cells.length >= action.limit)
        return draft;
      return { ...draft, cells: [...draft.cells, action.at] };
    }

    case "eraseCell": {
      const gone = cellKey(action.at);
      if (!draft.cells.some((c) => cellKey(c) === gone)) return draft;
      // Everything on the square and its sides goes with it, or the draft
      // would hold a wall with nothing on one side and a start in empty space.
      const cleared = applyEdit(draft, { type: "clearCell", at: action.at });
      return {
        ...cleared,
        cells: draft.cells.filter((c) => cellKey(c) !== gone),
      };
    }

    case "placeSegment": {
      const id = edgeKey(action.edge);
      const existing = draft.segments.find((s) => edgeKey(s) === id);

      if (action.kind === "gate" && !inBudget(action.gate, action.gateCount))
        return draft;

      // Spec §10.2: the active tool toggles. Clicking a wall with the wall
      // tool removes it, and so does clicking gate N with gate N; clicking
      // it with any other segment replaces it.
      const same =
        action.kind === "wall"
          ? existing?.kind === "wall"
          : existing?.kind === "gate" && existing.gate === action.gate;
      if (same) {
        return applyEdit(draft, { type: "removeSegment", edge: action.edge });
      }

      // A gate this replaces keeps its key, like any removed gate.
      const without = draft.segments.filter((s) => edgeKey(s) !== id);

      if (action.kind === "wall") {
        return {
          ...draft,
          segments: [...without, { ...action.edge, kind: "wall" }],
        };
      }

      // Each gate id appears once, so placing gate N elsewhere moves it.
      const { gate } = action;
      return {
        ...draft,
        segments: [
          ...without.filter((s) => s.kind !== "gate" || s.gate !== gate),
          { ...action.edge, kind: "gate", gate },
        ],
      };
    }

    case "setWall": {
      const existing = draft.segments.find(
        (s) => edgeKey(s) === edgeKey(action.edge),
      );
      if (existing?.kind === "wall") return draft;
      return applyEdit(draft, {
        type: "placeSegment",
        edge: action.edge,
        kind: "wall",
      });
    }

    case "removeSegment": {
      const id = edgeKey(action.edge);
      if (!draft.segments.some((s) => edgeKey(s) === id)) return draft;
      // A removed gate's key stays where the author put it: placing the
      // gate again pairs them up, and the validator flags it until then.
      return {
        ...draft,
        segments: draft.segments.filter((s) => edgeKey(s) !== id),
      };
    }

    case "placeKey": {
      if (!inBudget(action.gate, action.gateCount)) return draft;
      const at = cellKey(action.at);
      return {
        ...draft,
        keys: [
          ...draft.keys.filter(
            (k) => cellKey(k) !== at && k.gate !== action.gate,
          ),
          { gate: action.gate, x: action.at.x, y: action.at.y },
        ],
      };
    }

    case "clearItems": {
      const at = cellKey(action.at);
      const keys = draft.keys.filter((k) => cellKey(k) !== at);
      const start =
        draft.start && cellKey(draft.start) === at ? null : draft.start;
      const treasure =
        draft.treasure && cellKey(draft.treasure) === at
          ? null
          : draft.treasure;
      if (
        keys.length === draft.keys.length &&
        start === draft.start &&
        treasure === draft.treasure
      ) {
        return draft;
      }
      return { ...draft, keys, start, treasure };
    }

    case "clearCell": {
      const cleared = applyEdit(draft, { type: "clearItems", at: action.at });
      const segments = cleared.segments.filter(
        (s) => !edgeTouches(s, action.at),
      );
      if (segments.length === cleared.segments.length) return cleared;
      return { ...cleared, segments };
    }

    case "placeStart":
      return { ...draft, start: action.at };

    case "placeTreasure":
      return { ...draft, treasure: action.at };

    default:
      return draft;
  }
}

/** The gate ids that have a gate placed, or with "key", a key placed. */
export function placedNumbers(
  kind: "gate" | "key",
  draft: DraftMaze,
): ReadonlySet<number> {
  return new Set(
    kind === "key"
      ? draft.keys.map((k) => k.gate)
      : draft.segments.flatMap((s) => (s.kind === "gate" ? [s.gate] : [])),
  );
}

/**
 * The lowest number in 1..gateCount with no gate (or, with "key", no key)
 * placed yet, or null when every one is.
 */
export function lowestUnplaced(
  kind: "gate" | "key",
  draft: DraftMaze,
  gateCount: number,
): number | null {
  const placed = placedNumbers(kind, draft);
  for (let n = 1; n <= gateCount; n += 1) {
    if (!placed.has(n)) return n;
  }
  return null;
}

/** Whether `gate` is an id this maze's gate budget allows. */
function inBudget(gate: number, gateCount: number): boolean {
  return Number.isInteger(gate) && gate >= 1 && gate <= gateCount;
}
