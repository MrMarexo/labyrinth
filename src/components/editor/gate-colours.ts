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
 * Gate colours reuse the accent token's lightness and chroma — so they stay
 * correct in both themes — rotated to a per-gate hue. `GATE_HUES` alone is
 * what keeps adjacent gates distinct; `--color-danger` was tried as a second
 * base to alternate with, but at nearly the same lightness and chroma as
 * `--color-accent` the swap was imperceptible once the hue override ran, so
 * this uses one base instead of pretending to alternate.
 */
export function gateColour(gate: number): string {
  const hue = GATE_HUES[(gate - 1) % GATE_HUES.length];
  return `oklch(from var(--color-accent) l c ${hue})`;
}
