import { describe, expect, it } from "vitest";

import { parseMaze } from "~/maze/format";

/** The smallest maze that satisfies the schema: two cells side by side. */
const minimal = {
  version: 1,
  cells: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
  start: { x: 0, y: 0 },
  treasure: { x: 1, y: 0 },
  segments: [],
  keys: [],
};

describe("parseMaze", () => {
  it("accepts a well-formed maze", () => {
    const result = parseMaze(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.maze.cells).toHaveLength(2);
  });

  it("accepts walls and matched gate/key pairs", () => {
    const result = parseMaze({
      ...minimal,
      segments: [
        { o: "H", x: 0, y: 0, kind: "wall" },
        { o: "V", x: 0, y: 0, kind: "gate", gate: 1 },
      ],
      keys: [{ gate: 1, x: 1, y: 0 }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown version", () => {
    const result = parseMaze({ ...minimal, version: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toContain(
        "maze.format.unknownVersion",
      );
    }
  });

  it("rejects a gate segment with no gate id", () => {
    const result = parseMaze({
      ...minimal,
      segments: [{ o: "H", x: 0, y: 0, kind: "gate" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a gate id above the cap", () => {
    const result = parseMaze({
      ...minimal,
      segments: [{ o: "H", x: 0, y: 0, kind: "gate", gate: 9 }],
      keys: [{ gate: 9, x: 1, y: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toContain(
        "maze.format.gateIdOutOfRange",
      );
    }
  });

  it("rejects a coordinate outside the bounding box", () => {
    const result = parseMaze({
      ...minimal,
      cells: [
        { x: 0, y: 0 },
        { x: 16, y: 0 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toContain(
        "maze.format.coordinateOutOfRange",
      );
    }
  });

  it("rejects a non-integer coordinate", () => {
    const result = parseMaze({ ...minimal, start: { x: 0.5, y: 0 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toContain(
        "maze.format.coordinateNotAnInteger",
      );
    }
  });

  it("rejects a non-integer gate id", () => {
    const result = parseMaze({
      ...minimal,
      keys: [{ gate: 1.5, x: 1, y: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key)).toContain(
        "maze.format.gateIdNotAnInteger",
      );
    }
  });

  it("never produces an English message", () => {
    // Every issue must be a key. This is the guard that keeps the i18n
    // contract true as the schema grows.
    for (const bad of [
      { ...minimal, version: 99 },
      { ...minimal, cells: [] },
      { ...minimal, start: { x: -1, y: 0 } },
      { ...minimal, keys: [{ gate: 0, x: 0, y: 0 }] },
      { ...minimal, start: { x: 0.5, y: 0 } },
      { ...minimal, keys: [{ gate: 1.5, x: 1, y: 0 }] },
      "not an object",
      null,
    ]) {
      const result = parseMaze(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        for (const issue of result.issues) {
          expect(issue.key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/);
          expect(issue.key).not.toMatch(/\s/);
        }
      }
    }
  });
});
