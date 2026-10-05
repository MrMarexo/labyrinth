import type { DraftMaze } from "./draft";
import { MAX_GATES, type Orientation, type Point } from "./format";
import { cellKey, edgeKey, step, type Edge } from "./geometry";

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
};

export type EditorAction =
  | { type: "paintCell"; at: Point }
  | { type: "eraseCell"; at: Point }
  | { type: "placeSegment"; edge: Edge; kind: "wall" | "gate" }
  | { type: "removeSegment"; edge: Edge }
  | { type: "placeKey"; at: Point; gate: number }
  | { type: "removeKey"; at: Point }
  | { type: "placeStart"; at: Point }
  | { type: "placeTreasure"; at: Point }
  | { type: "undo" }
  | { type: "redo" };

export function initialEditorState(draft: DraftMaze): EditorState {
  return { draft, past: [], future: [] };
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
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return {
      draft: previous,
      past: state.past.slice(0, -1),
      future: [state.draft, ...state.future],
    };
  }

  if (action.type === "redo") {
    const next = state.future[0];
    if (!next) return state;
    return {
      draft: next,
      past: [...state.past, state.draft],
      future: state.future.slice(1),
    };
  }

  const draft = applyEdit(state.draft, action);

  // An edit that changed nothing must not cost an undo step: dragging across a
  // square that is already painted would otherwise fill the stack with no-ops.
  if (draft === state.draft) return state;

  return { draft, past: [...state.past, state.draft], future: [] };
}

function applyEdit(draft: DraftMaze, action: EditorAction): DraftMaze {
  switch (action.type) {
    case "paintCell": {
      if (draft.cells.some((c) => cellKey(c) === cellKey(action.at)))
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
      const survivingGates = new Set(
        segments.filter((s) => s.kind === "gate").map((s) => s.gate),
      );

      return {
        ...draft,
        cells,
        segments,
        keys: draft.keys.filter(
          (k) => cellKey(k) !== gone && survivingGates.has(k.gate),
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

      // Spec §10.2: the active tool toggles. Clicking a wall with the wall
      // tool removes it; clicking it with the gate tool replaces it.
      if (existing?.kind === action.kind) {
        return applyEdit(draft, { type: "removeSegment", edge: action.edge });
      }

      const without = draft.segments.filter((s) => edgeKey(s) !== id);
      const removedGate = existing?.kind === "gate" ? existing : undefined;

      if (action.kind === "wall") {
        return {
          ...draft,
          segments: [...without, { ...action.edge, kind: "wall" }],
          keys: removedGate
            ? draft.keys.filter((k) => k.gate !== removedGate.gate)
            : draft.keys,
        };
      }

      const gate = lowestFreeGate(without);
      if (gate === null) return draft;

      return {
        ...draft,
        segments: [...without, { ...action.edge, kind: "gate", gate }],
        keys: removedGate
          ? draft.keys.filter((k) => k.gate !== removedGate.gate)
          : draft.keys,
      };
    }

    case "removeSegment": {
      const id = edgeKey(action.edge);
      const removed = draft.segments.find((s) => edgeKey(s) === id);
      if (!removed) return draft;

      return {
        ...draft,
        segments: draft.segments.filter((s) => edgeKey(s) !== id),
        keys:
          removed.kind === "gate"
            ? draft.keys.filter((k) => k.gate !== removed.gate)
            : draft.keys,
      };
    }

    case "placeKey": {
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

/** The smallest gate id not already in use, or null when all 8 are taken. */
function lowestFreeGate(segments: DraftMaze["segments"]): number | null {
  const used = new Set(
    segments.filter((s) => s.kind === "gate").map((s) => s.gate),
  );
  for (let id = 1; id <= MAX_GATES; id += 1) {
    if (!used.has(id)) return id;
  }
  return null;
}
