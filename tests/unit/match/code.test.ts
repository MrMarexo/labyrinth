import { describe, expect, it } from "vitest";

import { CODE_ALPHABET, CODE_LENGTH, makeCode } from "~/match";

describe("makeCode", () => {
  it("draws one character per position from the alphabet", () => {
    const drawn: number[] = [];
    const code = makeCode((max) => {
      drawn.push(max);
      return drawn.length - 1;
    });
    expect(code).toBe(CODE_ALPHABET.slice(0, CODE_LENGTH));
    expect(drawn).toEqual(
      Array<number>(CODE_LENGTH).fill(CODE_ALPHABET.length),
    );
  });

  it("never emits a glyph that can be misread", () => {
    for (const forbidden of ["I", "L", "O", "0", "1"]) {
      expect(CODE_ALPHABET).not.toContain(forbidden);
    }
  });
});
