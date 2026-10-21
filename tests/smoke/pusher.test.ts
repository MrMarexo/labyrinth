import Pusher from "pusher";
import PusherClient from "pusher-js";
import { describe, expect, it } from "vitest";

const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } =
  process.env;
const configured = Boolean(
  PUSHER_APP_ID && PUSHER_KEY && PUSHER_SECRET && PUSHER_CLUSTER,
);

/**
 * Spec §8.1: the one test against the real service, nightly. It proves the
 * keys work and a server trigger reaches a client — not the app's channel
 * rules, which the local transport's tests cover. A public channel, so no
 * auth endpoint is needed. Skips itself until the keys are configured.
 */
describe.skipIf(!configured)("Pusher", () => {
  it("delivers a server trigger to a subscribed client", async () => {
    const server = new Pusher({
      appId: PUSHER_APP_ID!,
      key: PUSHER_KEY!,
      secret: PUSHER_SECRET!,
      cluster: PUSHER_CLUSTER!,
      useTLS: true,
    });
    const client = new PusherClient(PUSHER_KEY!, { cluster: PUSHER_CLUSTER! });
    const channelName = `smoke-${Date.now()}`;
    try {
      const channel = client.subscribe(channelName);
      await new Promise<void>((resolve, reject) => {
        channel.bind("pusher:subscription_succeeded", () => resolve());
        channel.bind("pusher:subscription_error", reject);
      });
      const received = new Promise<unknown>((resolve) =>
        channel.bind("ping", resolve),
      );
      await server.trigger(channelName, "ping", { at: channelName });
      expect(await received).toEqual({ at: channelName });
    } finally {
      client.disconnect();
    }
  });
});
