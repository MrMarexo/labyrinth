import { describe, expect, it } from "vitest";

import { safeNext } from "~/lib/safe-next";

describe("safeNext", () => {
  it("keeps a same-origin path", () => {
    expect(safeNext("/matches/x/join")).toBe("/matches/x/join");
  });

  it.each([
    null,
    undefined,
    "",
    "matches",
    "//evil.example",
    "/\\evil",
    "https://evil.example",
    "/%2F%2Fevil",
    "/%5Cevil",
  ])("rejects %j", (value) => {
    expect(safeNext(value)).toBeNull();
  });
});
