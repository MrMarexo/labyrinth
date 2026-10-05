import { describe, expect, it } from "vitest";

import { emptyDraft } from "~/maze/draft";
import {
  editorReducer,
  initialEditorState,
  cellsUsed,
  gatesPlaced,
  type EditorState,
} from "~/maze/editor-state";

function start(): EditorState {
  return initialEditorState(emptyDraft());
}

function apply(
  state: EditorState,
  ...actions: Parameters<typeof editorReducer>[1][]
) {
  return actions.reduce(editorReducer, state);
}

describe("painting", () => {
  it("adds a cell", () => {
    const next = editorReducer(start(), {
      type: "paintCell",
      at: { x: 1, y: 2 },
    });
    expect(next.draft.cells).toEqual([{ x: 1, y: 2 }]);
  });

  it("is idempotent — painting the same cell twice adds one", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 1, y: 2 } },
      { type: "paintCell", at: { x: 1, y: 2 } },
    );
    expect(cellsUsed(next.draft)).toBe(1);
  });

  it("erasing a cell removes what was on it", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "paintCell", at: { x: 1, y: 0 } },
      { type: "placeStart", at: { x: 1, y: 0 } },
      { type: "placeSegment", edge: { o: "V", x: 0, y: 0 }, kind: "wall" },
      { type: "eraseCell", at: { x: 1, y: 0 } },
    );
    expect(cellsUsed(next.draft)).toBe(1);
    expect(next.draft.start).toBeNull();
    // The wall had (1,0) on one side, so it goes too.
    expect(next.draft.segments).toEqual([]);
  });
});

describe("placing", () => {
  it("moves the start rather than adding a second", () => {
    const next = apply(
      start(),
      { type: "placeStart", at: { x: 0, y: 0 } },
      { type: "placeStart", at: { x: 2, y: 2 } },
    );
    expect(next.draft.start).toEqual({ x: 2, y: 2 });
  });

  it("numbers gates from 1 upward and pairs a key with each", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "H", x: 0, y: 0 }, kind: "gate" },
      { type: "placeSegment", edge: { o: "H", x: 1, y: 0 }, kind: "gate" },
    );
    expect(
      next.draft.segments.map((s) => (s.kind === "gate" ? s.gate : null)),
    ).toEqual([1, 2]);
    expect(gatesPlaced(next.draft)).toBe(2);
  });

  it("reuses the lowest free gate number after a removal", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "H", x: 0, y: 0 }, kind: "gate" },
      { type: "placeSegment", edge: { o: "H", x: 1, y: 0 }, kind: "gate" },
      { type: "removeSegment", edge: { o: "H", x: 0, y: 0 } },
      { type: "placeSegment", edge: { o: "H", x: 2, y: 0 }, kind: "gate" },
    );
    expect(
      next.draft.segments
        .map((s) => (s.kind === "gate" ? s.gate : null))
        .sort(),
    ).toEqual([1, 2]);
  });

  it("removing a gate removes its key too", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "H", x: 0, y: 0 }, kind: "gate" },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 1 },
      { type: "removeSegment", edge: { o: "H", x: 0, y: 0 } },
    );
    expect(next.draft.keys).toEqual([]);
  });

  it("replaces a wall with a gate rather than stacking", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "V", x: 1, y: 1 }, kind: "wall" },
      { type: "placeSegment", edge: { o: "V", x: 1, y: 1 }, kind: "gate" },
    );
    expect(next.draft.segments).toHaveLength(1);
    expect(next.draft.segments[0]?.kind).toBe("gate");
  });

  it("toggles off when the same tool hits the same edge twice", () => {
    // Spec §10.2: "Clicking an existing item with the active tool removes it."
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "V", x: 1, y: 1 }, kind: "wall" },
      { type: "placeSegment", edge: { o: "V", x: 1, y: 1 }, kind: "wall" },
    );
    expect(next.draft.segments).toEqual([]);
  });

  it("toggling a gate off takes its key with it", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "H", x: 0, y: 0 }, kind: "gate" },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 1 },
      { type: "placeSegment", edge: { o: "H", x: 0, y: 0 }, kind: "gate" },
    );
    expect(next.draft.segments).toEqual([]);
    expect(next.draft.keys).toEqual([]);
  });
});

describe("undo and redo", () => {
  it("undoes the last edit", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "paintCell", at: { x: 1, y: 0 } },
      { type: "undo" },
    );
    expect(cellsUsed(next.draft)).toBe(1);
  });

  it("redoes what was undone", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "undo" },
      { type: "redo" },
    );
    expect(cellsUsed(next.draft)).toBe(1);
  });

  it("a new edit discards the redo stack", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "undo" },
      { type: "paintCell", at: { x: 5, y: 5 } },
      { type: "redo" },
    );
    expect(next.draft.cells).toEqual([{ x: 5, y: 5 }]);
  });

  it("undo at the beginning is a no-op, not a crash", () => {
    const next = editorReducer(start(), { type: "undo" });
    expect(next.draft).toEqual(emptyDraft());
  });

  it("does not record history for an edit that changes nothing", () => {
    // Painting an already-painted cell must not cost an undo step, or dragging
    // across one square fills the stack with nothing.
    const once = editorReducer(start(), {
      type: "paintCell",
      at: { x: 0, y: 0 },
    });
    const twice = editorReducer(once, {
      type: "paintCell",
      at: { x: 0, y: 0 },
    });
    expect(twice.past).toHaveLength(once.past.length);
  });
});
