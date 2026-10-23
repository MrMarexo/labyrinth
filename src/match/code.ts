/**
 * No I, L, O, 0 or 1: a join code is read off one screen and typed into
 * another, usually by someone reading it aloud. Dropping the ambiguous
 * glyphs costs four characters of entropy and buys back every "was that a
 * one or an ell" round trip.
 */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/**
 * `draw(max)` returns an integer in [0, max). Randomness is the caller's to
 * supply so this module stays pure and the tests stay deterministic.
 */
export function makeCode(draw: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[draw(CODE_ALPHABET.length)];
  }
  return code;
}
