import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import sk from "../../../messages/sk.json";
import { MAZE_ISSUE_KEYS } from "~/maze";

// This file checks that each catalogue entry's {placeholder}s match the
// params the validator actually sends for that key — a pure data/contract
// check, run over both en.json and sk.json. It imports and renders nothing
// from ValidationPanel or any other component; that coverage lives in the
// end-to-end specs, not here.

type Catalogue = Record<string, unknown>;

const catalogues: [string, Catalogue][] = [
  ["en", en],
  ["sk", sk],
];

function lookup(catalogue: Catalogue, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Catalogue)[part]
          : undefined,
      catalogue,
    );
  return typeof value === "string" ? value : undefined;
}

/** Every {name} placeholder in a message. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

// The params each key is emitted with, read from src/maze/validate.ts and
// src/maze/index.ts. Locale-independent: the validator sends the same params
// regardless of which catalogue renders them. If a key gains or loses a
// param, this list must change with it — which is the point.
const expected: Record<string, string[]> = {
  "maze.validate.wrongCellCount": ["actual", "expected"],
  "maze.validate.boundingBoxTooLarge": ["height", "max", "width"],
  "maze.validate.keyOutsideShape": ["gate"],
  "maze.validate.cellHoldsTwoThings": ["x", "y"],
  "maze.validate.segmentOutsideShape": ["o", "x", "y"],
  "maze.validate.duplicateSegment": ["o", "x", "y"],
  "maze.validate.gateIdsNotContiguous": ["expected"],
  "maze.validate.gateWithoutKey": ["gate"],
  "maze.validate.gateWithTwoKeys": ["gate"],
  "maze.validate.keyWithoutGate": ["gate"],
};

describe.each(catalogues)(
  "issue copy and the params the code supplies (%s)",
  (_locale, catalogue) => {
    it.each(MAZE_ISSUE_KEYS)(
      "%s interpolates only params the code sends",
      (key) => {
        const message = lookup(catalogue, key);
        expect(message).toBeDefined();
        const used = placeholders(message!);
        const supplied = expected[key] ?? [];
        // A placeholder with no matching param renders as a literal brace to
        // the user — worse than plain copy, because it looks like a bug.
        expect(used.filter((p) => !supplied.includes(p))).toEqual([]);
      },
    );

    it("uses every param the code bothers to send", () => {
      // Not an error, but a param nobody renders is copy that could be clearer.
      for (const [key, params] of Object.entries(expected)) {
        const message = lookup(catalogue, key);
        expect(message, key).toBeDefined();
        const used = placeholders(message!);
        expect(
          params.filter((p) => !used.includes(p)),
          key,
        ).toEqual([]);
      }
    });

    it("boundingBoxTooLarge may reuse a placeholder", () => {
      // "{max} by {max}" is legitimate; the matcher must not treat the repeat
      // as an unused param.
      expect(lookup(catalogue, "maze.validate.boundingBoxTooLarge")).toContain(
        "{max}",
      );
    });
  },
);
