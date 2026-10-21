"use client";

import Pusher, { type PresenceChannel } from "pusher-js";
import { useEffect, useRef } from "react";

import { env } from "~/env";
import { EVENTS } from "~/match";

type Handlers = {
  onEvent?: (event: string, data: unknown) => void;
  /** Distinct users on a presence channel, including you. */
  onMembers?: (count: number) => void;
  /**
   * The subscription opened, first time or after a reconnect: anything
   * published before it was missed, so refetch from the server.
   */
  onCatchUp?: () => void;
};

let pusher: Pusher | null = null;

function pusherClient(): Pusher | null {
  if (!env.NEXT_PUBLIC_PUSHER_KEY || !env.NEXT_PUBLIC_PUSHER_CLUSTER) {
    return null;
  }
  return (pusher ??= new Pusher(env.NEXT_PUBLIC_PUSHER_KEY, {
    cluster: env.NEXT_PUBLIC_PUSHER_CLUSTER,
    channelAuthorization: {
      endpoint: "/api/realtime/auth",
      transport: "ajax",
    },
  }));
}

/**
 * One realtime subscription, over Pusher when it is configured and the local
 * event stream otherwise (spec §8.1). Handlers are read through a ref, so
 * they may change every render without resubscribing; the effect depends on
 * `channel` alone, so a refetch from `onCatchUp` cannot resubscribe.
 * `onCatchUp` fires once per (re)subscription: on Pusher's
 * `subscription_succeeded`, which pusher-js re-fires after a reconnect, and
 * on each EventSource `open`.
 *
 * Subscribing to the same channel from two components on one page is not
 * supported: with Pusher, the first to unmount unsubscribes both. No page
 * does it.
 */
export function useChannel(channel: string | null, handlers: Handlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!channel) return;

    const client = pusherClient();
    if (client) {
      const sub = client.subscribe(channel);
      const relay = (event: string, data: unknown) => {
        if (!event.startsWith("pusher:")) latest.current.onEvent?.(event, data);
      };
      sub.bind_global(relay);
      const members = () =>
        latest.current.onMembers?.((sub as PresenceChannel).members.count);
      const catchUp = () => latest.current.onCatchUp?.();
      // pusher-js resubscribes every channel after a reconnect and fires
      // subscription_succeeded again, so this one binding covers the first
      // open and every reconnect alike.
      sub.bind("pusher:subscription_succeeded", catchUp);
      const presence = channel.startsWith("presence-");
      if (presence) {
        sub.bind("pusher:subscription_succeeded", members);
        sub.bind("pusher:member_added", members);
        sub.bind("pusher:member_removed", members);
      }
      return () => {
        sub.unbind_global(relay);
        sub.unbind("pusher:subscription_succeeded", catchUp);
        if (presence) {
          sub.unbind("pusher:subscription_succeeded", members);
          sub.unbind("pusher:member_added", members);
          sub.unbind("pusher:member_removed", members);
        }
        client.unsubscribe(channel);
      };
    }

    const source = new EventSource(
      `/api/realtime/stream?channel=${encodeURIComponent(channel)}`,
    );
    // EventSource reconnects by itself; every open, the first included, may
    // follow events the caller missed.
    source.onopen = () => latest.current.onCatchUp?.();
    const forward = (event: string) => (message: MessageEvent<string>) =>
      latest.current.onEvent?.(event, JSON.parse(message.data) as unknown);
    const onMove = forward(EVENTS.move);
    const onChanged = forward(EVENTS.changed);
    const onMembers = (message: MessageEvent<string>) =>
      latest.current.onMembers?.(
        (JSON.parse(message.data) as { count: number }).count,
      );
    source.addEventListener(EVENTS.move, onMove);
    source.addEventListener(EVENTS.changed, onChanged);
    source.addEventListener(EVENTS.members, onMembers);
    return () => source.close();
  }, [channel]);
}
