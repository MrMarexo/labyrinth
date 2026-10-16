import { describe, expect, it } from "vitest";

import { formatElapsed } from "~/lib/format-elapsed";

describe("formatElapsed", () => {
  it("shows minutes and zero-padded seconds under an hour", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(247_000)).toBe("4:07");
  });

  it("adds hours from an hour up, padding the minutes", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(26 * 3_600_000 + 5 * 60_000 + 9_000)).toBe("26:05:09");
  });

  it("truncates rather than rounds, so 59.9s never reads as a minute", () => {
    expect(formatElapsed(59_900)).toBe("0:59");
  });
});
