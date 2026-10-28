import { describe, expect, it } from "vitest";

import { MAZE_LIMIT, mazeState, savedCount } from "~/maze";

describe("mazeState", () => {
  const saved = { concept: false };

  it("calls a saved draft that does not validate a draft", () => {
    expect(mazeState({ ...saved, contentHash: null })).toBe("draft");
  });

  it("calls a saved draft that validates ready", () => {
    expect(mazeState({ ...saved, contentHash: "h" })).toBe("ready");
  });

  it("calls the labyrinth in progress a concept, valid or not", () => {
    for (const contentHash of [null, "h"]) {
      expect(mazeState({ concept: true, contentHash })).toBe("concept");
    }
  });
});

describe("MAZE_LIMIT", () => {
  it("is 10", () => {
    expect(MAZE_LIMIT).toBe(10);
  });
});

describe("savedCount", () => {
  it("counts every saved state but not the concept", () => {
    const states = ["concept", "draft", "ready", "ready"] as const;
    expect(savedCount(states.map((state) => ({ state })))).toBe(3);
  });
});
