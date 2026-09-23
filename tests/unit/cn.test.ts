import { describe, expect, it } from "vitest";

import { cn } from "~/lib/cn";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("px-2", "font-bold")).toBe("px-2 font-bold");
  });

  it("drops falsy values", () => {
    expect(cn("px-2", false, null, undefined, "font-bold")).toBe(
      "px-2 font-bold",
    );
  });

  it("lets a later Tailwind class win over an earlier conflicting one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
