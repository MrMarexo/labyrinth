import { describe, expect, it } from "vitest";

import { draftMazeSchema, draftToMaze, emptyDraft } from "~/maze/draft";

describe("emptyDraft", () => {
  it("is a valid draft with nothing placed", () => {
    const draft = emptyDraft();
    expect(draftMazeSchema.safeParse(draft).success).toBe(true);
    expect(draft.cells).toEqual([]);
    expect(draft.start).toBeNull();
    expect(draft.treasure).toBeNull();
  });
});

describe("draftMazeSchema", () => {
  it("accepts a half-drawn maze with no start or treasure", () => {
    const result = draftMazeSchema.safeParse({
      version: 1,
      cells: [{ x: 0, y: 0 }],
      start: null,
      treasure: null,
      segments: [],
      keys: [],
    });
    expect(result.success).toBe(true);
  });

  it("still rejects an out-of-frame coordinate", () => {
    // A draft is permissive about completeness, never about the frame.
    const result = draftMazeSchema.safeParse({
      ...emptyDraft(),
      cells: [{ x: 16, y: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("draftToMaze", () => {
  it("returns null while the start is missing", () => {
    expect(
      draftToMaze({
        ...emptyDraft(),
        cells: [{ x: 0, y: 0 }],
        treasure: { x: 0, y: 0 },
      }),
    ).toBeNull();
  });

  it("returns null while the treasure is missing", () => {
    expect(
      draftToMaze({
        ...emptyDraft(),
        cells: [{ x: 0, y: 0 }],
        start: { x: 0, y: 0 },
      }),
    ).toBeNull();
  });

  it("upgrades a complete draft to a Maze", () => {
    const maze = draftToMaze({
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 1, y: 0 },
      segments: [{ o: "V", x: 0, y: 0, kind: "wall" }],
      keys: [],
    });

    expect(maze).not.toBeNull();
    expect(maze?.start).toEqual({ x: 0, y: 0 });
    expect(maze?.segments).toHaveLength(1);
  });
});
