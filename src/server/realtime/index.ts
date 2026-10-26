import "server-only";

import { after } from "next/server";
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

const pusherClientConfigured = Boolean(
  env.NEXT_PUBLIC_PUSHER_KEY && env.NEXT_PUBLIC_PUSHER_CLUSTER,
);

if (pusherConfigured !== pusherClientConfigured) {
  console.warn(
    "[realtime] Pusher is half-configured: set all four PUSHER_* variables and both NEXT_PUBLIC_PUSHER_* ones, or none, or the client and server will disagree about the transport.",
  );
}

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

/** A hung Pusher call must not stall a move response or the sweep. */
export const PUBLISH_TIMEOUT_MS = 2000;

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), PUBLISH_TIMEOUT_MS);
    });
    const outcome = await Promise.race([
      active.publish(channel, event, data),
      timedOut,
    ]);
    if (outcome === "timeout") {
      console.error(`[realtime] publishing ${event} on ${channel} timed out`);
    }
  } catch (error) {
    console.error(`[realtime] publishing ${event} on ${channel} failed`, error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `work` once the response has gone out, so the caller does not wait on
 * Pusher. Outside a request (the integration tests) `after` throws, and the
 * work starts at once instead; `publishSafely` never rejects either way.
 */
export function afterResponse(work: () => Promise<unknown>): void {
  try {
    after(work);
  } catch (error) {
    // Expected only in the tests. Anywhere else an unawaited publish may be
    // frozen with the function and never sent, which should not go unnoticed.
    if (process.env.NODE_ENV === "production") {
      console.error("[realtime] after() unavailable; publishing inline", error);
    }
    void work();
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
