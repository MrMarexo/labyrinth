/** How long after a match ends its replays, and its deleted mazes, are kept. */
export const REPLAY_RETENTION_DAYS = 30;

const RETENTION_MS = REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Whether the match's replays are gone. An open match has no end yet. */
export function replayExpired(endedAt: Date | null, now: Date): boolean {
  return endedAt !== null && now.getTime() - endedAt.getTime() >= RETENTION_MS;
}

/**
 * Whether a maze's drawing is gone from this match's result: purged (`null`),
 * or deleted by its author and past the match's replay window. Inside the
 * window a deleted maze still shows, exactly as its replay does.
 */
export function drawingDeleted(
  m: { deletedAt: Date | null } | null,
  endedAt: Date | null,
  now: Date,
): boolean {
  if (m === null) return true;
  return m.deletedAt !== null && replayExpired(endedAt, now);
}
