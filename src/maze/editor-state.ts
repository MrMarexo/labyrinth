import type { DraftMaze } from "./draft";
import type { Orientation, Point } from "./format";
import { cellKey, edgeKey, isInteriorEdge, step, type Edge } from "./geometry";

export type Tool =
  | "paint"
  | "erase-cell"
  | "wall"
  | "gate"
  | "key"
  | "start"
  | "treasure"
  | "erase";

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
  | { type: "removeKey"; at: Point }
  | { type: "placeStart"; at: Point }
  | { type: "placeTreasure"; at: Point }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "beginStroke" }
  | { type: "endStroke" };

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
 * could never be fixed. They are dropped on load, along with any dropped
 * gate's key, so the cleanup doesn't just trade one error for
 * `keyWithoutGate`.
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

  let keys = draft.keys;
  for (const dropped of draft.segments) {
    if (dropped.kind === "gate" && !isInteriorEdge(dropped, painted)) {
      keys = releaseKeyForGate(keys, dropped.gate);
    }
  }
  return { ...draft, segments, keys };
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

      // Anything that referenced the square goes with it, or the draft would
      // hold a wall with nothing on one side and a start in empty space.
      const cells = draft.cells.filter((c) => cellKey(c) !== gone);
      const segments = draft.segments.filter((s) => !touches(s, action.at));
      // Only the keys of gates this erase removed: a key placed before its
      // gate has no gate to lose, and stays.
      const removedGates = new Set(
        draft.segments.flatMap((s) =>
          s.kind === "gate" && touches(s, action.at) ? [s.gate] : [],
        ),
      );

      return {
        ...draft,
        cells,
        segments,
        keys: draft.keys.filter(
          (k) => cellKey(k) !== gone && !removedGates.has(k.gate),
        ),
        start:
          draft.start && cellKey(draft.start) === gone ? null : draft.start,
        treasure:
          draft.treasure && cellKey(draft.treasure) === gone
            ? null
            : draft.treasure,
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

      const without = draft.segments.filter((s) => edgeKey(s) !== id);
      const keys = releaseKeyForGate(
        draft.keys,
        existing?.kind === "gate" ? existing.gate : undefined,
      );

      if (action.kind === "wall") {
        return {
          ...draft,
          segments: [...without, { ...action.edge, kind: "wall" }],
          keys,
        };
      }

      // Each gate id appears once, so placing gate N elsewhere moves it. Its
      // key stays: the gate it opens still exists.
      const { gate } = action;
      return {
        ...draft,
        segments: [
          ...without.filter((s) => s.kind !== "gate" || s.gate !== gate),
          { ...action.edge, kind: "gate", gate },
        ],
        keys,
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
      const removed = draft.segments.find((s) => edgeKey(s) === id);
      if (!removed) return draft;

      return {
        ...draft,
        segments: draft.segments.filter((s) => edgeKey(s) !== id),
        keys: releaseKeyForGate(
          draft.keys,
          removed.kind === "gate" ? removed.gate : undefined,
        ),
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

    case "removeKey": {
      const at = cellKey(action.at);
      if (!draft.keys.some((k) => cellKey(k) === at)) return draft;
      return { ...draft, keys: draft.keys.filter((k) => cellKey(k) !== at) };
    }

    case "placeStart":
      return { ...draft, start: action.at };

    case "placeTreasure":
      return { ...draft, treasure: action.at };

    default:
      return draft;
  }
}

/** True when one of the edge's two cells is `at`. */
function touches(
  edge: { o: Orientation; x: number; y: number },
  at: Point,
): boolean {
  const here = { x: edge.x, y: edge.y };
  const other = edge.o === "H" ? step(here, "S") : step(here, "E");
  return cellKey(here) === cellKey(at) || cellKey(other) === cellKey(at);
}

/**
 * Removes whichever key is paired with `gate`, or returns `keys` unchanged
 * when `gate` is undefined. The one place that enforces "a key cannot
 * outlive its gate" — `placeSegment` and `removeSegment` both route through
 * it rather than each filtering `keys` themselves.
 */
function releaseKeyForGate(
  keys: DraftMaze["keys"],
  gate: number | undefined,
): DraftMaze["keys"] {
  return gate === undefined ? keys : keys.filter((k) => k.gate !== gate);
}

/** Whether `gate` is an id this maze's gate budget allows. */
function inBudget(gate: number, gateCount: number): boolean {
  return Number.isInteger(gate) && gate >= 1 && gate <= gateCount;
}
