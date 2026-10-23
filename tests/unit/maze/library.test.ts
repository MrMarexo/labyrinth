import { describe, expect, it } from "vitest";

import { MAZE_LIMIT, mazeState } from "~/maze";

describe("mazeState", () => {
  it("calls a draft that does not validate a draft", () => {
    expect(mazeState({ status: "draft", contentHash: null })).toBe("draft");
  });

  it("calls a draft that validates ready", () => {
    expect(mazeState({ status: "draft", contentHash: "h" })).toBe("ready");
  });

  it("calls a submitted maze used", () => {
    expect(mazeState({ status: "submitted", contentHash: "h" })).toBe("used");
  });
});

describe("MAZE_LIMIT", () => {
  it("is 10", () => {
    expect(MAZE_LIMIT).toBe(10);
  });
});
