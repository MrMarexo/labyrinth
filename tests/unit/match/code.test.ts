import { describe, expect, it } from "vitest";

import { CODE_ALPHABET, CODE_LENGTH, makeCode, matchCodeSchema } from "~/match";

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

describe("matchCodeSchema", () => {
  it("accepts a lowercase code and uppercases it", () => {
    const parsed = matchCodeSchema.parse("abcdef".slice(0, CODE_LENGTH));
    expect(parsed).toBe("ABCDEF".slice(0, CODE_LENGTH));
  });

  it("trims surrounding whitespace", () => {
    expect(matchCodeSchema.parse("  ABCDEF  ")).toBe("ABCDEF");
  });

  it("rejects a code of the wrong length with a message key", () => {
    const result = matchCodeSchema.safeParse("ABC");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("errors.matchCodeMalformed");
  });

  it("rejects a code containing an excluded glyph", () => {
    const result = matchCodeSchema.safeParse("ABCDE0");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("errors.matchCodeMalformed");
  });
});
