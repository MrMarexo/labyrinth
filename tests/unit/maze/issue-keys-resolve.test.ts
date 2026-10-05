import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import sk from "../../../messages/sk.json";
import { MAZE_FORMAT_ISSUE_KEYS, MAZE_ISSUE_KEYS } from "~/maze";

import { ROUTER_KEYS } from "./router-keys";

type Catalogue = Record<string, unknown>;

/** Resolves "a.b.c" against a nested catalogue, or undefined. */
function lookup(catalogue: Catalogue, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Catalogue)[part]
          : undefined,
      catalogue,
    );
}

const allKeys = [...MAZE_ISSUE_KEYS, ...MAZE_FORMAT_ISSUE_KEYS, ...ROUTER_KEYS];

describe("every maze issue key resolves", () => {
  it("has at least one key to check", () => {
    // Guards against the whole suite passing vacuously if the unions empty out.
    expect(allKeys.length).toBeGreaterThan(20);
  });

  it.each(allKeys)("en: %s", (key) => {
    expect(typeof lookup(en as Catalogue, key)).toBe("string");
  });

  it.each(allKeys)("sk: %s", (key) => {
    expect(typeof lookup(sk as Catalogue, key)).toBe("string");
  });

  it("resolves the generic fallback that src/lib/issues.ts hardcodes", () => {
    expect(typeof lookup(en as Catalogue, "errors.validation.invalid")).toBe(
      "string",
    );
    expect(typeof lookup(sk as Catalogue, "errors.validation.invalid")).toBe(
      "string",
    );
  });
});
