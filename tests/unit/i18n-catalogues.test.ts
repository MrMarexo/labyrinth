import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import sk from "../../messages/sk.json";

type Catalogue = Record<string, unknown>;

function flatten(value: Catalogue, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" && child !== null
      ? flatten(child as Catalogue, path)
      : [path];
  });
}

function valuesOf(value: Catalogue, prefix = ""): Array<[string, unknown]> {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" && child !== null
      ? valuesOf(child as Catalogue, path)
      : [[path, child] as [string, unknown]];
  });
}

describe("message catalogues", () => {
  it("sk has exactly the same keys as en", () => {
    expect(flatten(sk as Catalogue).sort()).toEqual(
      flatten(en as Catalogue).sort(),
    );
  });

  it("has no empty or whitespace-only strings", () => {
    for (const catalogue of [en, sk] as Catalogue[]) {
      for (const [path, value] of valuesOf(catalogue)) {
        expect(typeof value, `${path} must be a string`).toBe("string");
        expect(String(value).trim(), `${path} must not be empty`).not.toBe("");
      }
    }
  });
});
