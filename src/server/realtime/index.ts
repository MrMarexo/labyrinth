import "server-only";

import Pusher from "pusher";

import { env } from "~/env";

import { localPublisher, type RealtimePublisher } from "./local-bus";

export type { RealtimePublisher } from "./local-bus";

export const pusherConfigured = Boolean(
  env.PUSHER_APP_ID &&
  env.PUSHER_KEY &&
  env.PUSHER_SECRET &&
  env.PUSHER_CLUSTER,
);

const pusher = pusherConfigured
  ? new Pusher({
      appId: env.PUSHER_APP_ID!,
      key: env.PUSHER_KEY!,
      secret: env.PUSHER_SECRET!,
      cluster: env.PUSHER_CLUSTER!,
      useTLS: true,
    })
  : null;

if (!pusher && process.env.VERCEL) {
  console.warn(
    "[realtime] No Pusher keys: live updates are off on this deployment; clients fall back to polling.",
  );
}

let active: RealtimePublisher = pusher
  ? {
      async publish(channel, event, data) {
        await pusher.trigger(channel, event, data);
      },
    }
  : localPublisher;

export function getPusher(): Pusher | null {
  return pusher;
}

/**
 * Spec §8: publishing never fails a move. Callers publish after their
 * transaction commits; an error here is logged and swallowed, and a watcher
 * who missed the event recovers it from the move log.
 */
export async function publishSafely(
  channel: string,
  event: string,
  data: unknown,
): Promise<void> {
  try {
    await active.publish(channel, event, data);
  } catch (error) {
    console.error(`[realtime] publishing ${event} on ${channel} failed`, error);
  }
}

/** Integration tests only: capture or break publishing. Returns a restore. */
export function swapPublisherForTests(next: RealtimePublisher): () => void {
  const previous = active;
  active = next;
  return () => {
    active = previous;
  };
}
