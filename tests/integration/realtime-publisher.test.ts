import { describe, expect, it, vi } from "vitest";

import {
  PUBLISH_TIMEOUT_MS,
  publishSafely,
  swapPublisherForTests,
} from "~/server/realtime";

describe("publishSafely", () => {
  it("swallows a publisher error", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const restore = swapPublisherForTests({
      async publish() {
        throw new Error("pusher is down");
      },
    });
    try {
      await expect(publishSafely("c", "e", {})).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      restore();
      error.mockRestore();
    }
  });

  it("hands the event to the active publisher, and restores the previous one", async () => {
    const seen: unknown[] = [];
    const restore = swapPublisherForTests({
      async publish(channel, event, data) {
        seen.push({ channel, event, data });
      },
    });
    await publishSafely("c", "e", { n: 1 });
    restore();
    await publishSafely("c", "e", { n: 2 });
    expect(seen).toEqual([{ channel: "c", event: "e", data: { n: 1 } }]);
  });

  it("gives up on a publish that never settles", async () => {
    vi.useFakeTimers();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const restore = swapPublisherForTests({
      publish: () => new Promise<void>(() => undefined),
    });
    try {
      let settled = false;
      const done = publishSafely("c", "e", {}).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(PUBLISH_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(settled).toBe(true);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      restore();
      error.mockRestore();
      vi.useRealTimers();
    }
  });
});
