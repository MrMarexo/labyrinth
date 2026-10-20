import { describe, expect, it, vi } from "vitest";

import { publishSafely, swapPublisherForTests } from "~/server/realtime";

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
});
