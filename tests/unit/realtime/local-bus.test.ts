import { describe, expect, it } from "vitest";

import {
  emit,
  join,
  memberCount,
  subscribe,
} from "~/server/realtime/local-bus";

const unique = () => `presence-run_${crypto.randomUUID()}_u`;

describe("the local bus", () => {
  it("delivers to subscribers of that channel only", () => {
    const a = unique();
    const b = unique();
    const got: unknown[] = [];
    const off = subscribe(a, (event, data) => got.push([event, data]));
    emit(a, "move", { seq: 1 });
    emit(b, "move", { seq: 2 });
    off();
    emit(a, "move", { seq: 3 });
    expect(got).toEqual([["move", { seq: 1 }]]);
  });

  it("keeps delivering when one listener throws", () => {
    const channel = unique();
    const got: number[] = [];
    const offBad = subscribe(channel, () => {
      throw new Error("closed stream");
    });
    const offGood = subscribe(channel, () => got.push(1));
    expect(() => emit(channel, "move", {})).not.toThrow();
    expect(got).toEqual([1]);
    offBad();
    offGood();
  });

  it("counts distinct members and announces changes", () => {
    const channel = unique();
    const counts: number[] = [];
    const off = subscribe(channel, (event, data) => {
      if (event === "realtime:members") {
        counts.push((data as { count: number }).count);
      }
    });
    const leaveA1 = join(channel, "a");
    const leaveA2 = join(channel, "a"); // a second tab: same member
    const leaveB = join(channel, "b");
    expect(memberCount(channel)).toBe(2);
    leaveA1();
    expect(memberCount(channel)).toBe(2);
    leaveA2();
    leaveB();
    expect(memberCount(channel)).toBe(0);
    expect(counts).toEqual([1, 2, 1, 0]);
    off();
  });

  it("makes leaving idempotent", () => {
    const channel = unique();
    const leave = join(channel, "a");
    leave();
    leave();
    expect(memberCount(channel)).toBe(0);
  });
});
