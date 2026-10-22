import { describe, expect, it } from "vitest";

import {
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
    let done = false;
    const waiting = discardsSettled().then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    await waiting;
  });
});
