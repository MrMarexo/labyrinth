/**
 * How long after a match ends its replays, and its copies of the players'
 * mazes, are kept.
 */
export const REPLAY_RETENTION_DAYS = 30;

const RETENTION_MS = REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Whether the match's replays are gone. An open match has no end yet. */
export function replayExpired(endedAt: Date | null, now: Date): boolean {
  return endedAt !== null && now.getTime() - endedAt.getTime() >= RETENTION_MS;
}
