import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DIRECTIONS, type Direction, type Maze } from "~/maze/format";
import { cellKey, edgeBetween, edgeKey, step } from "~/maze/geometry";
import { applyMove, initialRunState } from "~/maze/reduce";
import {
  advanceRun,
  discovery,
  emptyMap,
  freshRun,
  heldKeys,
  pathFrom,
  recordDelta,
} from "~/maze/run";

/**
 * Three cells in a row with the start in the middle, a key to the west and a
 * gate to the east. The runner can walk west, bump the boundary, come back,
 * and open the gate, which exercises every kind of reveal on a board small
 * enough to check by eye.
 */
function corridor(): Maze {
  return {
    version: 1,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
    start: { x: 1, y: 0 },
    treasure: { x: 3, y: 0 },
    segments: [{ o: "V", x: 1, y: 0, kind: "gate", gate: 1 }],
    keys: [{ gate: 1, x: 0, y: 0 }],
  };
}

function walk(maze: Maze, dirs: readonly Direction[]) {
  let run = freshRun(maze);
  const deltas = [];
  for (const dir of dirs) {
    const step = advanceRun(run, maze, dir);
    run = step.run;
    deltas.push(step.delta);
  }
  return { run, deltas };
}

describe("emptyMap", () => {
  it("knows only the start cell, at the origin", () => {
    expect(emptyMap()).toEqual({
      cells: [{ x: 0, y: 0 }],
      segments: [],
      passages: [],
    });
  });
});

describe("recordDelta", () => {
  it("adds the cell entered, in the start-relative frame", () => {
    const { run } = walk(corridor(), ["W"]);
    expect(run.view.map.cells).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0, key: 1 },
    ]);
    expect(run.view.at).toEqual({ x: -1, y: 0 });
  });

  it("records a bumped gate once, however often it is bumped", () => {
    const { run } = walk(corridor(), ["E", "E", "E"]);
    expect(run.view.map.segments).toEqual([
      { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
    ]);
    expect(run.state.penalties).toBe(3);
  });

  it("does not lose a cell's key when the cell is revisited", () => {
    const { run } = walk(corridor(), ["W", "E", "W"]);
    const keyed = run.view.map.cells.find((c) => c.x === -1);
    expect(keyed).toEqual({ x: -1, y: 0, key: 1 });
    expect(run.view.map.cells).toHaveLength(2);
  });

  it("records a wall and a boundary identically", () => {
    // West of the key cell is off the shape; the runner must not be able to
    // tell from the map that no square is there.
    const { run } = walk(corridor(), ["W", "W"]);
    expect(run.view.map.segments).toEqual([
      { o: "V", x: -2, y: 0, kind: "wall" },
    ]);
  });

  it("records the edge a move crossed as a passage", () => {
    const { run } = walk(corridor(), ["W"]);
    expect(run.view.map.passages).toEqual([{ o: "V", x: -1, y: 0 }]);
  });

  it("records a passage once, however often it is crossed", () => {
    const { run } = walk(corridor(), ["W", "E", "W", "E"]);
    expect(run.view.map.passages).toEqual([{ o: "V", x: -1, y: 0 }]);
  });

  it("records no passage for a bump", () => {
    const { run } = walk(corridor(), ["E", "W", "W"]);
    // E bumps the gate, W crosses to the key, W bumps the boundary.
    expect(run.view.map.passages).toEqual([{ o: "V", x: -1, y: 0 }]);
  });

  it("records a crossed gate as both a segment and a passage", () => {
    const { run } = walk(corridor(), ["W", "E", "E"]);
    expect(run.view.map.segments).toEqual([
      { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
    ]);
    expect(run.view.map.passages).toEqual([
      { o: "V", x: -1, y: 0 },
      { o: "V", x: 0, y: 0 },
    ]);
  });

  it("accepts a map stored before passages were recorded", () => {
    const maze = corridor();
    const { delta } = applyMove(maze, initialRunState(maze), "W");
    const legacy = { cells: [{ x: 0, y: 0 }], segments: [] };
    expect(recordDelta(legacy as never, delta).passages).toEqual([
      { o: "V", x: -1, y: 0 },
    ]);
  });

  it("returns a new map and leaves the old one alone", () => {
    const map = emptyMap();
    const maze = corridor();
    const { delta } = applyMove(maze, initialRunState(maze), "W");
    const next = recordDelta(map, delta);
    expect(next).not.toBe(map);
    expect(map).toEqual(emptyMap());
  });
});

describe("heldKeys", () => {
  it("is every key on a revealed cell, in gate order", () => {
    expect(heldKeys(emptyMap())).toEqual([]);
    expect(heldKeys(walk(corridor(), ["W"]).run.view.map)).toEqual([1]);
  });
});

describe("pathFrom", () => {
  it("starts at the origin and adds a point only for moves that moved", () => {
    const { deltas } = walk(corridor(), ["W", "W", "E", "E", "E"]);
    // W (key), W (bump: no point), E (back to start), E (through the gate,
    // now held), E (treasure).
    expect(pathFrom(deltas)).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("is just the origin for a run with no moves", () => {
    expect(pathFrom([])).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("advanceRun", () => {
  it("keeps the absolute state and the relative view in step", () => {
    const maze = corridor();
    const { run } = walk(maze, ["W", "E", "E"]);
    expect(run.state.at).toEqual({ x: 2, y: 0 });
    expect(run.view.at).toEqual({
      x: run.state.at.x - maze.start.x,
      y: run.state.at.y - maze.start.y,
    });
  });
});

describe("the map holds nothing the runner has not touched", () => {
  it("contains exactly the cells stood on, for any walk", () => {
    const maze = corridor();
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Direction>(...DIRECTIONS), { maxLength: 40 }),
        (dirs) => {
          const { run, deltas } = walk(maze, dirs);
          const stoodOn = new Set(pathFrom(deltas).map(cellKey));
          const mapped = new Set(run.view.map.cells.map(cellKey));
          expect(mapped).toEqual(stoodOn);
        },
      ),
    );
  });

  it("contains exactly the edges crossed, for any walk", () => {
    const maze = corridor();
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Direction>(...DIRECTIONS), { maxLength: 40 }),
        (dirs) => {
          const { run, deltas } = walk(maze, dirs);
          const crossed = new Set(
            deltas
              .filter((d) => cellKey(d.at) !== cellKey(d.from))
              .map((d) => {
                const dir = DIRECTIONS.find(
                  (x) => cellKey(step(d.from, x)) === cellKey(d.at),
                )!;
                return edgeKey(edgeBetween(d.from, dir));
              }),
          );
          const mapped = run.view.map.passages.map(edgeKey);
          expect(new Set(mapped)).toEqual(crossed);
          expect(mapped).toHaveLength(crossed.size);
        },
      ),
    );
  });

  it("contains exactly the segments bumped or crossed, for any walk", () => {
    const maze = corridor();
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Direction>(...DIRECTIONS), { maxLength: 40 }),
        (dirs) => {
          const { run, deltas } = walk(maze, dirs);
          const revealed = new Set(
            deltas.flatMap((d) =>
              d.revealedSegment
                ? [
                    `${d.revealedSegment.o}:${d.revealedSegment.x},${d.revealedSegment.y}`,
                  ]
                : [],
            ),
          );
          const mapped = new Set(
            run.view.map.segments.map((s) => `${s.o}:${s.x},${s.y}`),
          );
          expect(mapped).toEqual(revealed);
        },
      ),
    );
  });
});

describe("discovery", () => {
  /** What each move of `dirs` discovered, against the map before it. */
  function discoveries(dirs: readonly Direction[]) {
    let map = emptyMap();
    return walk(corridor(), dirs).deltas.map((delta) => {
      const found = discovery(map, delta);
      map = recordDelta(map, delta);
      return found;
    });
  }

  it("finds a key on the first visit only", () => {
    expect(discoveries(["W", "E", "W"])).toEqual([
      { kind: "key", gate: 1 },
      null,
      null,
    ]);
  });

  it("finds a gate on the first bump only", () => {
    expect(discoveries(["E", "E"])).toEqual([{ kind: "gate", gate: 1 }, null]);
  });

  it("finds a gate first walked through with its key", () => {
    expect(discoveries(["W", "E", "E"])).toEqual([
      { kind: "key", gate: 1 },
      null,
      { kind: "gate", gate: 1 },
    ]);
  });

  it("does not find an already bumped gate again when opening it", () => {
    expect(discoveries(["E", "W", "E", "E"])).toEqual([
      { kind: "gate", gate: 1 },
      { kind: "key", gate: 1 },
      null,
      null,
    ]);
  });
});
