import { describe, expect, it } from "vitest";

import { emptyDraft, type DraftMaze } from "~/maze/draft";
import { incompleteDraftIssues } from "~/maze/validate";

const settings = { cellCount: 4, gateCount: 2 };

function draft(overrides: Partial<DraftMaze>): DraftMaze {
  return { ...emptyDraft(), ...overrides };
}

const block = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

describe("incompleteDraftIssues", () => {
  it("lists everything an empty draft lacks", () => {
    expect(incompleteDraftIssues(emptyDraft(), settings)).toEqual([
      {
        key: "maze.validate.wrongCellCount",
        params: { actual: 0, expected: 4 },
      },
      { key: "maze.validate.missingGates", params: { missing: 2 } },
      { key: "maze.validate.missingStart" },
      { key: "maze.validate.missingTreasure" },
    ]);
  });

  it("names a placed gate that still has no key", () => {
    const issues = incompleteDraftIssues(
      draft({
        cells: block,
        segments: [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }],
      }),
      settings,
    );
    expect(issues).toContainEqual({
      key: "maze.validate.missingGates",
      params: { missing: 1 },
    });
    expect(issues).toContainEqual({
      key: "maze.validate.gateWithoutKey",
      params: { gate: 1 },
    });
  });

  it("says only what is still missing", () => {
    expect(
      incompleteDraftIssues(draft({ cells: block, start: { x: 0, y: 0 } }), {
        cellCount: 4,
        gateCount: 0,
      }),
    ).toEqual([{ key: "maze.validate.missingTreasure" }]);
  });
});
