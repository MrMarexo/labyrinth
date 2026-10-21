import { describe, expect, it } from "vitest";

import { emptyDraft } from "~/maze/draft";
import {
  editorReducer,
  initialEditorState,
  cellsUsed,
  gatesPlaced,
  keysPlaced,
  lowestUnplaced,
  type EditorState,
} from "~/maze/editor-state";
import { edgeKey } from "~/maze/geometry";

/** A budget wide enough that no test below runs into it by accident. */
const GATES = 8;

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
    // Asserted both through the counter and directly against the collection:
    // a broken dedup and a broken counter are different bugs, and a fixture
    // that only checks `cellsUsed` cannot tell them apart.
    expect(next.draft.cells).toHaveLength(1);
    expect(cellsUsed(next.draft)).toBe(1);
  });

  it("counts several distinct cells, not just whether any are painted", () => {
    // Every other call site in this file asserts `cellsUsed` at exactly 1,
    // which a hardcoded `cellsUsed() { return 1 }` would also satisfy. This
    // is the one test that would catch that.
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "paintCell", at: { x: 1, y: 0 } },
      { type: "paintCell", at: { x: 2, y: 0 } },
    );
    expect(next.draft.cells).toHaveLength(3);
    expect(cellsUsed(next.draft)).toBe(3);
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

  it("places the gate number it is given, and pairs a key with each", () => {
    const next = apply(
      start(),
      {
        type: "placeSegment",
        edge: { o: "H", x: 0, y: 0 },
        kind: "gate",
        gate: 1,
        gateCount: GATES,
      },
      {
        type: "placeSegment",
        edge: { o: "H", x: 1, y: 0 },
        kind: "gate",
        gate: 2,
        gateCount: GATES,
      },
    );
    expect(
      next.draft.segments.map((s) => (s.kind === "gate" ? s.gate : null)),
    ).toEqual([1, 2]);
    expect(gatesPlaced(next.draft)).toBe(2);
  });

  it("removing a gate removes its key too", () => {
    const next = apply(
      start(),
      {
        type: "placeSegment",
        edge: { o: "H", x: 0, y: 0 },
        kind: "gate",
        gate: 1,
        gateCount: GATES,
      },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 1, gateCount: GATES },
      { type: "removeSegment", edge: { o: "H", x: 0, y: 0 } },
    );
    expect(next.draft.keys).toEqual([]);
  });

  it("replaces a wall with a gate rather than stacking", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: { o: "V", x: 1, y: 1 }, kind: "wall" },
      {
        type: "placeSegment",
        edge: { o: "V", x: 1, y: 1 },
        kind: "gate",
        gate: 1,
        gateCount: GATES,
      },
    );
    expect(next.draft.segments).toHaveLength(1);
    expect(next.draft.segments[0]?.kind).toBe("gate");
    // Distinct from the "numbers gates" test's count of 2, so a hardcoded
    // `gatesPlaced() { return 2 }` cannot satisfy both.
    expect(gatesPlaced(next.draft)).toBe(1);
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
      {
        type: "placeSegment",
        edge: { o: "H", x: 0, y: 0 },
        kind: "gate",
        gate: 1,
        gateCount: GATES,
      },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 1, gateCount: GATES },
      {
        type: "placeSegment",
        edge: { o: "H", x: 0, y: 0 },
        kind: "gate",
        gate: 1,
        gateCount: GATES,
      },
    );
    expect(next.draft.segments).toEqual([]);
    expect(next.draft.keys).toEqual([]);
    // A third distinct value (0, alongside 1 and 2 above) for the same
    // reason: no constant return satisfies all three.
    expect(gatesPlaced(next.draft)).toBe(0);
  });

  it("counts placed keys, including across more than one gate", () => {
    const next = apply(
      start(),
      {
        type: "placeSegment",
        edge: { o: "H", x: 0, y: 0 },
        kind: "gate",
        gate: 1,
        gateCount: GATES,
      },
      {
        type: "placeSegment",
        edge: { o: "H", x: 1, y: 0 },
        kind: "gate",
        gate: 2,
        gateCount: GATES,
      },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 1, gateCount: GATES },
      { type: "placeKey", at: { x: 4, y: 4 }, gate: 2, gateCount: GATES },
    );
    expect(next.draft.keys).toHaveLength(2);
    expect(keysPlaced(next.draft)).toBe(2);
  });

  it("removing a gate drops its key from the count, not just from the array", () => {
    const withKey = apply(
      start(),
      {
        type: "placeSegment",
        edge: { o: "H", x: 0, y: 0 },
        kind: "gate",
        gate: 1,
        gateCount: GATES,
      },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 1, gateCount: GATES },
    );
    expect(keysPlaced(withKey.draft)).toBe(1);

    const next = editorReducer(withKey, {
      type: "removeSegment",
      edge: { o: "H", x: 0, y: 0 },
    });
    expect(keysPlaced(next.draft)).toBe(0);
  });

  it("removeKey removes an existing key", () => {
    const withKey = apply(
      start(),
      {
        type: "placeSegment",
        edge: { o: "H", x: 0, y: 0 },
        kind: "gate",
        gate: 1,
        gateCount: GATES,
      },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 1, gateCount: GATES },
    );
    const next = editorReducer(withKey, {
      type: "removeKey",
      at: { x: 3, y: 3 },
    });
    expect(next.draft.keys).toEqual([]);
  });

  it("placeTreasure sets the treasure", () => {
    const next = editorReducer(start(), {
      type: "placeTreasure",
      at: { x: 5, y: 5 },
    });
    expect(next.draft.treasure).toEqual({ x: 5, y: 5 });
  });

  it("placeTreasure moves the treasure rather than adding a second", () => {
    const next = apply(
      start(),
      { type: "placeTreasure", at: { x: 0, y: 0 } },
      { type: "placeTreasure", at: { x: 2, y: 2 } },
    );
    expect(next.draft.treasure).toEqual({ x: 2, y: 2 });
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

describe("strokes", () => {
  it("starts outside a stroke", () => {
    expect(start().strokeBase).toBeNull();
  });

  it("makes a whole stroke one undo step", () => {
    const before = apply(start(), { type: "paintCell", at: { x: 9, y: 9 } });
    const after = apply(
      before,
      { type: "beginStroke" },
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "paintCell", at: { x: 1, y: 0 } },
      { type: "paintCell", at: { x: 2, y: 0 } },
      { type: "endStroke" },
    );
    expect(after.draft.cells).toHaveLength(4);
    expect(after.past).toHaveLength(before.past.length + 1);
    expect(after.strokeBase).toBeNull();

    const undone = editorReducer(after, { type: "undo" });
    expect(undone.draft).toBe(before.draft);
    expect(undone.past).toEqual(before.past);
  });

  it("records no history for a stroke that changes nothing", () => {
    const before = apply(start(), { type: "paintCell", at: { x: 0, y: 0 } });
    const after = apply(
      before,
      { type: "beginStroke" },
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "endStroke" },
    );
    expect(after.past).toHaveLength(before.past.length);
    expect(after.draft).toBe(before.draft);
    expect(after.strokeBase).toBeNull();
  });

  it("ignores undo and redo in the middle of a stroke", () => {
    const mid = apply(
      start(),
      { type: "paintCell", at: { x: 5, y: 5 } },
      { type: "paintCell", at: { x: 6, y: 5 } },
      { type: "undo" },
      { type: "beginStroke" },
      { type: "paintCell", at: { x: 0, y: 0 } },
    );
    expect(editorReducer(mid, { type: "undo" })).toBe(mid);
    expect(editorReducer(mid, { type: "redo" })).toBe(mid);
  });

  it("does not touch the history until the stroke ends, then clears redo", () => {
    const undone = apply(
      start(),
      { type: "paintCell", at: { x: 5, y: 5 } },
      { type: "undo" },
    );
    const mid = apply(
      undone,
      { type: "beginStroke" },
      { type: "paintCell", at: { x: 0, y: 0 } },
    );
    expect(mid.past).toEqual(undone.past);

    const ended = editorReducer(mid, { type: "endStroke" });
    expect(ended.future).toEqual([]);
    expect(ended.past).toHaveLength(undone.past.length + 1);
  });

  it("ending a stroke that never began changes nothing", () => {
    const state = start();
    expect(editorReducer(state, { type: "endStroke" })).toBe(state);
  });
});

describe("setWall", () => {
  const edge = { o: "V", x: 1, y: 1 } as const;

  it("adds a wall, and adding it again is a no-op rather than a toggle", () => {
    const once = editorReducer(start(), { type: "setWall", edge });
    expect(once.draft.segments).toEqual([{ ...edge, kind: "wall" }]);

    const twice = editorReducer(once, { type: "setWall", edge });
    expect(twice).toBe(once);
  });

  it("replaces a gate and releases the gate's key", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge, kind: "gate", gate: 1, gateCount: GATES },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 1, gateCount: GATES },
      { type: "setWall", edge },
    );
    expect(next.draft.segments).toEqual([{ ...edge, kind: "wall" }]);
    expect(next.draft.keys).toEqual([]);
    expect(gatesPlaced(next.draft)).toBe(0);
  });
});

describe("painting against a limit", () => {
  it("refuses a new square once the limit is reached", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 }, limit: 2 },
      { type: "paintCell", at: { x: 1, y: 0 }, limit: 2 },
      { type: "paintCell", at: { x: 2, y: 0 }, limit: 2 },
    );
    expect(next.draft.cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });
});

describe("loading a draft with segments outside the shape", () => {
  const cells = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];

  it("drops a wall on an outline edge", () => {
    const state = initialEditorState({
      ...emptyDraft(),
      cells,
      segments: [
        { o: "V", x: 0, y: 0, kind: "wall" },
        { o: "H", x: 0, y: 0, kind: "wall" },
      ],
    });
    expect(state.draft.segments).toEqual([
      { o: "V", x: 0, y: 0, kind: "wall" },
    ]);
    expect(state.past).toEqual([]);
  });

  it("drops a gate on an outline edge and releases its key", () => {
    const state = initialEditorState({
      ...emptyDraft(),
      cells,
      segments: [
        { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
        { o: "H", x: 1, y: 0, kind: "gate", gate: 2 },
      ],
      keys: [
        { gate: 1, x: 0, y: 0 },
        { gate: 2, x: 1, y: 0 },
      ],
    });
    expect(state.draft.segments).toEqual([
      { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
    ]);
    expect(state.draft.keys).toEqual([{ gate: 1, x: 0, y: 0 }]);
  });

  it("hands back the very same draft when nothing needs dropping", () => {
    const draft = {
      ...emptyDraft(),
      cells,
      segments: [{ o: "V" as const, x: 0, y: 0, kind: "wall" as const }],
    };
    expect(initialEditorState(draft).draft).toBe(draft);
  });
});

describe("choosing the gate number", () => {
  const a = { o: "H", x: 0, y: 0 } as const;
  const b = { o: "H", x: 1, y: 0 } as const;
  const gates = (state: EditorState) =>
    state.draft.segments.flatMap((s) =>
      s.kind === "gate" ? [{ edge: edgeKey(s), gate: s.gate }] : [],
    );

  it("placing gate 2 where gate 2 already is elsewhere moves it, keeping its key", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: a, kind: "gate", gate: 2, gateCount: 2 },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 2, gateCount: 2 },
      { type: "placeSegment", edge: b, kind: "gate", gate: 2, gateCount: 2 },
    );
    expect(gates(next)).toEqual([{ edge: "H:1,0", gate: 2 }]);
    expect(next.draft.keys).toEqual([{ gate: 2, x: 3, y: 3 }]);
  });

  it("refuses a gate above the maze's gate count, leaving the draft as it was", () => {
    const before = apply(start(), {
      type: "placeSegment",
      edge: a,
      kind: "gate",
      gate: 1,
      gateCount: 2,
    });
    const next = editorReducer(before, {
      type: "placeSegment",
      edge: b,
      kind: "gate",
      gate: 3,
      gateCount: 2,
    });
    expect(next).toBe(before);
  });

  it("refuses a gate below 1", () => {
    const before = start();
    const next = editorReducer(before, {
      type: "placeSegment",
      edge: a,
      kind: "gate",
      gate: 0,
      gateCount: 2,
    });
    expect(next).toBe(before);
  });

  it("refuses any gate in a maze with no gates", () => {
    const before = start();
    const next = editorReducer(before, {
      type: "placeSegment",
      edge: a,
      kind: "gate",
      gate: 1,
      gateCount: 0,
    });
    expect(next).toBe(before);
  });

  it("refuses a key above the maze's gate count", () => {
    const before = start();
    const next = editorReducer(before, {
      type: "placeKey",
      at: { x: 3, y: 3 },
      gate: 3,
      gateCount: 2,
    });
    expect(next).toBe(before);
  });

  it("accepts a key before its gate is placed", () => {
    const next = editorReducer(start(), {
      type: "placeKey",
      at: { x: 3, y: 3 },
      gate: 2,
      gateCount: 2,
    });
    expect(next.draft.keys).toEqual([{ gate: 2, x: 3, y: 3 }]);
  });

  it("clicking gate N onto gate N removes it and releases key N", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: a, kind: "gate", gate: 2, gateCount: 2 },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 2, gateCount: 2 },
      { type: "placeSegment", edge: a, kind: "gate", gate: 2, gateCount: 2 },
    );
    expect(gates(next)).toEqual([]);
    expect(next.draft.keys).toEqual([]);
  });

  it("placing gate 1 over gate 2 removes gate 2 and releases key 2", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: a, kind: "gate", gate: 2, gateCount: 2 },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 2, gateCount: 2 },
      { type: "placeKey", at: { x: 4, y: 4 }, gate: 1, gateCount: 2 },
      { type: "placeSegment", edge: a, kind: "gate", gate: 1, gateCount: 2 },
    );
    expect(gates(next)).toEqual([{ edge: "H:0,0", gate: 1 }]);
    expect(next.draft.keys).toEqual([{ gate: 1, x: 4, y: 4 }]);
  });

  it("moving gate 1 onto gate 2's edge leaves one gate there and releases key 2", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: a, kind: "gate", gate: 1, gateCount: 2 },
      { type: "placeSegment", edge: b, kind: "gate", gate: 2, gateCount: 2 },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 2, gateCount: 2 },
      { type: "placeSegment", edge: b, kind: "gate", gate: 1, gateCount: 2 },
    );
    expect(gates(next)).toEqual([{ edge: "H:1,0", gate: 1 }]);
    expect(next.draft.keys).toEqual([]);
  });

  it("erasing a square keeps a key whose gate is not placed yet", () => {
    const next = apply(
      start(),
      { type: "paintCell", at: { x: 0, y: 0 } },
      { type: "paintCell", at: { x: 3, y: 3 } },
      { type: "placeKey", at: { x: 3, y: 3 }, gate: 2, gateCount: 2 },
      { type: "eraseCell", at: { x: 0, y: 0 } },
    );
    expect(next.draft.keys).toEqual([{ gate: 2, x: 3, y: 3 }]);
  });
});

describe("lowestUnplaced", () => {
  const a = { o: "H", x: 0, y: 0 } as const;
  const b = { o: "H", x: 1, y: 0 } as const;

  it("is 1 on an empty draft, and null when the maze has no gates", () => {
    expect(lowestUnplaced("gate", start().draft, 2)).toBe(1);
    expect(lowestUnplaced("key", start().draft, 2)).toBe(1);
    expect(lowestUnplaced("gate", start().draft, 0)).toBeNull();
  });

  it("skips placed gates, and is null once every one is placed", () => {
    const one = apply(start(), {
      type: "placeSegment",
      edge: a,
      kind: "gate",
      gate: 1,
      gateCount: 2,
    });
    expect(lowestUnplaced("gate", one.draft, 2)).toBe(2);
    // Keys are counted on their own: gate 1 being placed says nothing about key 1.
    expect(lowestUnplaced("key", one.draft, 2)).toBe(1);

    const both = editorReducer(one, {
      type: "placeSegment",
      edge: b,
      kind: "gate",
      gate: 2,
      gateCount: 2,
    });
    expect(lowestUnplaced("gate", both.draft, 2)).toBeNull();
  });

  it("offers a number again after its gate is removed", () => {
    const next = apply(
      start(),
      { type: "placeSegment", edge: a, kind: "gate", gate: 1, gateCount: 2 },
      { type: "placeSegment", edge: b, kind: "gate", gate: 2, gateCount: 2 },
      { type: "removeSegment", edge: a },
    );
    expect(lowestUnplaced("gate", next.draft, 2)).toBe(1);
  });

  it("skips placed keys", () => {
    const next = apply(
      start(),
      { type: "placeKey", at: { x: 1, y: 1 }, gate: 1, gateCount: 3 },
      { type: "placeKey", at: { x: 2, y: 1 }, gate: 3, gateCount: 3 },
    );
    expect(lowestUnplaced("key", next.draft, 3)).toBe(2);
  });
});
