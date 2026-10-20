/**
 * Spec §8. Pusher needs the `presence-` and `private-` prefixes; the ids
 * inside never contain "_" (match ids are UUIDs, Better Auth user ids are
 * alphanumeric), so "_" separates them unambiguously.
 */
const RUN_PREFIX = "presence-run_";
const MATCH_PREFIX = "private-match_";

/** A runner's moves, as they happen. Presence: the members are the watchers. */
export function runChannel(matchId: string, runnerId: string): string {
  return `${RUN_PREFIX}${matchId}_${runnerId}`;
}

/** Payload-free "something changed" pings for both players. */
export function matchChannel(matchId: string): string {
  return `${MATCH_PREFIX}${matchId}`;
}

export type ParsedChannel =
  | { kind: "run"; matchId: string; runnerId: string }
  | { kind: "match"; matchId: string };

export function parseChannel(name: string): ParsedChannel | null {
  if (name.startsWith(RUN_PREFIX)) {
    const parts = name.slice(RUN_PREFIX.length).split("_");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { kind: "run", matchId: parts[0], runnerId: parts[1] };
  }
  if (name.startsWith(MATCH_PREFIX)) {
    const matchId = name.slice(MATCH_PREFIX.length);
    if (!matchId || matchId.includes("_")) return null;
    return { kind: "match", matchId };
  }
  return null;
}

export function isPresenceChannel(name: string): boolean {
  return name.startsWith("presence-");
}

/**
 * Event names, shared by server and client. `members` is ours, not
 * Pusher's: the local stream sends it, and `useChannel` maps Pusher's own
 * member events onto the same callback.
 */
export const EVENTS = {
  move: "move",
  changed: "changed",
  members: "realtime:members",
} as const;
