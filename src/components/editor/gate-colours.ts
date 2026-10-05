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
 * Gate colours reuse the accent and danger tokens — so they stay correct in
 * both themes — rotated to a per-gate hue. Odd gates read off the accent,
 * even gates off danger, which keeps adjacent gate numbers visually distinct
 * even before the hue difference registers.
 */
export function gateColour(gate: number): string {
  const hue = GATE_HUES[(gate - 1) % GATE_HUES.length];
  const base = gate % 2 === 0 ? "var(--color-danger)" : "var(--color-accent)";
  return `oklch(from ${base} l c ${hue})`;
}
