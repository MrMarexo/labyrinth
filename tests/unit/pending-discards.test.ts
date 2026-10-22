import { describe, expect, it, vi } from "vitest";

import {
  DISCARD_WAIT_CAP_MS,
  discardsSettled,
  trackDiscard,
} from "~/components/editor/pending-discards";

describe("pending discards", () => {
  it("resolves at once with nothing tracked", async () => {
    await expect(discardsSettled()).resolves.toBeUndefined();
  });

  it("waits for a tracked discard, even one that fails", async () => {
    let settleOk!: () => void;
    let settleBad!: (reason: Error) => void;
    trackDiscard(new Promise<void>((resolve) => (settleOk = resolve)));
    const bad = new Promise<void>((_, reject) => (settleBad = reject));
    bad.catch(() => undefined);
    trackDiscard(bad);

    let done = false;
    const waiting = discardsSettled().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);

    settleOk();
    await Promise.resolve();
    expect(done).toBe(false);

    settleBad(new Error("offline"));
    await waiting;
    expect(done).toBe(true);
  });

  it("forgets a discard once it has settled", async () => {
    trackDiscard(Promise.resolve());
    await discardsSettled();
    // With nothing left to wait on, it resolves without any time passing:
    // not held to the cap.
    vi.useFakeTimers();
    try {
      let done = false;
      const waiting = discardsSettled().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
      await waiting;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the wait's cap", () => {
  it("gives up on a leave that never settles, after the cap", async () => {
    vi.useFakeTimers();
    try {
      trackDiscard(new Promise<void>(() => undefined));
      let done = false;
      const waiting = discardsSettled().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(DISCARD_WAIT_CAP_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
