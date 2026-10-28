import { MAX_GATES } from "~/maze";

/**
 * One hue per gate, spaced evenly around the wheel (360° / MAX_GATES, so 45°
 * apart for the current 8) rather than picked by eye — an even split
 * maximises the minimum separation between any two gates by construction.
 * `tests/unit/gate-hues.test.ts` holds the array to that guarantee, so a
 * future change to MAX_GATES without a matching look at this spacing fails
 * loudly instead of quietly producing two gates that are hard to tell apart.
 */
export const GATE_HUES: readonly number[] = Array.from(
  { length: MAX_GATES },
  (_, i) => (i * 360) / MAX_GATES,
);

/**
 * Gate colours reuse the `--gate-base` token's lightness and chroma — so they
 * stay correct in both themes — rotated to a per-gate hue. That token exists
 * for this alone: the accent is ink or cream, with almost no chroma, and
 * rotating the hue of a near-grey colour would turn every gate grey. `GATE_HUES`
 * alone is what keeps adjacent gates distinct.
 */
export function gateColour(gate: number): string {
  const hue = GATE_HUES[(gate - 1) % GATE_HUES.length];
  return `oklch(from var(--color-gate-base) l c ${hue})`;
}
