import { describe, expect, it } from "vitest";

import type { Maze } from "~/maze/format";
import { validateStructure } from "~/maze/validate";

/** A 2x2 block of four cells, no segments. */
function square(): Maze {
  return {
    version: 1,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    start: { x: 0, y: 0 },
    treasure: { x: 1, y: 1 },
    segments: [],
    keys: [],
  };
}

const settings = { cellCount: 4, gateCount: 0 };

function keys(maze: Maze, s = settings): string[] {
  return validateStructure(maze, s).map((i) => i.key);
}

describe("validateStructure", () => {
  it("accepts a valid maze", () => {
    expect(validateStructure(square(), settings)).toEqual([]);
  });

  it("rejects a cell count that does not match the match setting", () => {
    expect(keys(square(), { cellCount: 36, gateCount: 0 })).toContain(
      "maze.validate.wrongCellCount",
    );
  });

  it("reports the expected and actual counts as params", () => {
    const issue = validateStructure(square(), {
      cellCount: 36,
      gateCount: 0,
    }).find((i) => i.key === "maze.validate.wrongCellCount");
    expect(issue?.params).toEqual({ expected: 36, actual: 4 });
  });

  it("rejects duplicate cells", () => {
    const maze = square();
    maze.cells[1] = { x: 0, y: 0 };
    expect(keys(maze)).toContain("maze.validate.duplicateCell");
  });

  it("rejects a disconnected shape", () => {
    const maze = square();
    maze.cells[3] = { x: 5, y: 5 };
    maze.treasure = { x: 5, y: 5 };
    expect(keys(maze)).toContain("maze.validate.disconnectedShape");
  });

  it("rejects a start that is not a painted cell", () => {
    const maze = square();
    maze.start = { x: 9, y: 9 };
    expect(keys(maze)).toContain("maze.validate.startNotInShape");
  });

  it("rejects a treasure that is not a painted cell", () => {
    const maze = square();
    maze.treasure = { x: 9, y: 9 };
    expect(keys(maze)).toContain("maze.validate.treasureNotInShape");
  });

  it("rejects start and treasure on the same cell", () => {
    const maze = square();
    maze.treasure = { ...maze.start };
    expect(keys(maze)).toContain("maze.validate.startIsTreasure");
  });

  it("rejects a key on the start cell", () => {
    const maze = square();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }];
    maze.keys = [{ gate: 1, x: 0, y: 0 }];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.keyOnStart",
    );
  });

  it("rejects two keys on one cell", () => {
    const maze = square();
    maze.segments = [
      { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
      { o: "V", x: 0, y: 1, kind: "gate", gate: 2 },
    ];
    maze.keys = [
      { gate: 1, x: 1, y: 0 },
      { gate: 2, x: 1, y: 0 },
    ];
    expect(keys(maze, { cellCount: 4, gateCount: 2 })).toContain(
      "maze.validate.cellHoldsTwoThings",
    );
  });

  it("rejects a bounding box wider than the cap", () => {
    const maze = square();
    maze.cells = [{ x: 0, y: 0 }];
    for (let x = 1; x < 17; x += 1) maze.cells.push({ x, y: 0 });
    maze.treasure = { x: 16, y: 0 };
    expect(keys(maze, { cellCount: 17, gateCount: 0 })).toContain(
      "maze.validate.boundingBoxTooLarge",
    );
  });

  it("rejects a segment whose neighbour is not painted", () => {
    const maze = square();
    // The south edge of (0,1) faces a void square.
    maze.segments = [{ o: "H", x: 0, y: 1, kind: "wall" }];
    expect(keys(maze)).toContain("maze.validate.segmentOutsideShape");
  });

  it("rejects two segments on the same edge", () => {
    const maze = square();
    maze.segments = [
      { o: "V", x: 0, y: 0, kind: "wall" },
      { o: "V", x: 0, y: 0, kind: "wall" },
    ];
    expect(keys(maze)).toContain("maze.validate.duplicateSegment");
  });

  it("rejects gate ids that are not exactly 1..gateCount", () => {
    const maze = square();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 2 }];
    maze.keys = [{ gate: 2, x: 1, y: 1 }];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.gateIdsNotContiguous",
    );
  });

  it("rejects one gate id used twice", () => {
    const maze = square();
    maze.segments = [
      { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
      { o: "V", x: 0, y: 1, kind: "gate", gate: 1 },
    ];
    maze.keys = [{ gate: 1, x: 1, y: 1 }];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.gateIdReused",
    );
  });

  it("rejects a gate with no key", () => {
    const maze = square();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.gateWithoutKey",
    );
  });

  it("rejects a gate with two keys", () => {
    const maze = square();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }];
    // Neither key sits on start or treasure, so this isolates the
    // one-key-per-gate rule from the occupancy and start rules.
    maze.keys = [
      { gate: 1, x: 1, y: 0 },
      { gate: 1, x: 0, y: 1 },
    ];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.gateWithTwoKeys",
    );
  });

  it("rejects a key whose gate id does not exist", () => {
    const maze = square();
    maze.keys = [{ gate: 1, x: 1, y: 0 }];
    expect(keys(maze, { cellCount: 4, gateCount: 0 })).toContain(
      "maze.validate.keyWithoutGate",
    );
  });

  it("rejects a key whose cell is not painted", () => {
    const maze = square();
    maze.segments = [{ o: "V", x: 0, y: 0, kind: "gate", gate: 1 }];
    maze.keys = [{ gate: 1, x: 9, y: 9 }];
    expect(keys(maze, { cellCount: 4, gateCount: 1 })).toContain(
      "maze.validate.keyOutsideShape",
    );
  });

  it("accepts a one-cell-wide corridor", () => {
    // Spec §3.3: there is deliberately no minimum width.
    const maze: Maze = {
      version: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      start: { x: 0, y: 0 },
      treasure: { x: 2, y: 0 },
      segments: [],
      keys: [],
    };
    expect(validateStructure(maze, { cellCount: 3, gateCount: 0 })).toEqual([]);
  });

  it("every issue it can produce is a message key", () => {
    const maze = square();
    maze.cells[1] = { x: 0, y: 0 };
    maze.start = { x: 9, y: 9 };
    maze.segments = [{ o: "H", x: 0, y: 1, kind: "wall" }];
    for (const issue of validateStructure(maze, {
      cellCount: 9,
      gateCount: 3,
    })) {
      expect(issue.key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/);
    }
  });
});
