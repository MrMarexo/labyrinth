/**
 * The fallback for a dropped connection, or none at all (Vercel without
 * Pusher keys): realtime events are the notification (spec §8), and this
 * catches what a lost connection missed.
 */
export const POLL_MS = 60_000;
