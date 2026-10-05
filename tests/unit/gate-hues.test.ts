import { describe, expect, it } from "vitest";

import { GATE_HUES } from "~/components/editor/gate-colours";
import { MAX_GATES } from "~/maze";

/**
 * Circular distance between two hues on a 360° wheel. A naive `Math.abs(a -
 * b)` gets this wrong exactly at the wrap: 340° and 10° are 30° apart, not
 * 330° apart. That wrap bug is what put two gate hues 15° and 30° apart in
 * the array this test now guards.
 */
function circularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

describe("circularDistance", () => {
  it("wraps around 360 instead of subtracting naively", () => {
    // The exact pair that was computed wrong: naive |340 - 10| = 330, but the
    // true distance going the short way round the wheel is 30.
    expect(circularDistance(340, 10)).toBe(30);
    expect(circularDistance(10, 340)).toBe(30);
  });

  it("handles a wrap that crosses zero", () => {
    expect(circularDistance(0, 350)).toBe(10);
  });

  it("returns the ordinary difference when there is no wrap to consider", () => {
    expect(circularDistance(0, 180)).toBe(180);
    expect(circularDistance(10, 25)).toBe(15);
  });
});

describe("GATE_HUES", () => {
  it("has exactly one hue per gate", () => {
    expect(GATE_HUES.length).toBe(MAX_GATES);
  });

  it("keeps every pair of gates at least 40° apart, so adjacent gate numbers never look alike", () => {
    let minimum = 360;
    for (let i = 0; i < GATE_HUES.length; i += 1) {
      for (let j = i + 1; j < GATE_HUES.length; j += 1) {
        minimum = Math.min(
          minimum,
          circularDistance(GATE_HUES[i]!, GATE_HUES[j]!),
        );
      }
    }
    expect(minimum).toBeGreaterThanOrEqual(40);
  });
});
