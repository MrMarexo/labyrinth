import { EVENTS } from "~/match";

export type RealtimePublisher = {
  publish(channel: string, event: string, data: unknown): Promise<void>;
};

type Listener = (event: string, data: unknown) => void;

type Bus = {
  listeners: Map<string, Set<Listener>>;
  /** channel → userId → open connections, so a second tab is one member. */
  members: Map<string, Map<string, number>>;
};

// On globalThis, like the database pool, so `next dev`'s module reloading
// cannot split publishers and subscribers onto two different buses.
const holder = globalThis as unknown as { realtimeBus?: Bus };
const bus: Bus = (holder.realtimeBus ??= {
  listeners: new Map(),
  members: new Map(),
});

/**
 * Spec §8.1's in-process implementation. It reaches only subscribers in this
 * Node process — the SSE stream route — which is why it serves local dev,
 * `next start` and the e2e suite, and why a real deployment uses Pusher.
 */
export function subscribe(channel: string, listener: Listener): () => void {
  let set = bus.listeners.get(channel);
  if (!set) bus.listeners.set(channel, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) bus.listeners.delete(channel);
  };
}

/**
 * Synchronous delivery. A listener that throws — typically a stream whose
 * browser has gone — must not stop the others, nor the publisher.
 */
export function emit(channel: string, event: string, data: unknown): void {
  for (const listener of [...(bus.listeners.get(channel) ?? [])]) {
    try {
      listener(event, data);
    } catch {
      // The stream route unsubscribes on abort; until then, skip it.
    }
  }
}

export function memberCount(channel: string): number {
  return bus.members.get(channel)?.size ?? 0;
}

/** Presence: counts distinct users, and announces every change in count. */
export function join(channel: string, userId: string): () => void {
  let users = bus.members.get(channel);
  if (!users) bus.members.set(channel, (users = new Map<string, number>()));
  const before = users.size;
  users.set(userId, (users.get(userId) ?? 0) + 1);
  if (users.size !== before) announce(channel);

  let left = false;
  return () => {
    if (left) return;
    left = true;
    const current = bus.members.get(channel);
    if (!current) return;
    const open = (current.get(userId) ?? 1) - 1;
    if (open > 0) {
      current.set(userId, open);
      return;
    }
    current.delete(userId);
    if (current.size === 0) bus.members.delete(channel);
    announce(channel);
  };
}

function announce(channel: string) {
  emit(channel, EVENTS.members, { count: memberCount(channel) });
}

export const localPublisher: RealtimePublisher = {
  async publish(channel, event, data) {
    emit(channel, event, data);
  },
};
