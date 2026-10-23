import { describe, expect, it } from "vitest";

import { REPLAY_RETENTION_DAYS, drawingDeleted, replayExpired } from "~/match";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("replayExpired", () => {
  it("is 30 days", () => {
    expect(REPLAY_RETENTION_DAYS).toBe(30);
  });

  it("never expires an open match", () => {
    expect(replayExpired(null, NOW)).toBe(false);
  });

  it("keeps a replay until the last millisecond of the window", () => {
    expect(replayExpired(ago(30 * DAY - 1), NOW)).toBe(false);
  });

  it("expires a replay exactly 30 days after the end", () => {
    expect(replayExpired(ago(30 * DAY), NOW)).toBe(true);
    expect(replayExpired(ago(31 * DAY), NOW)).toBe(true);
  });
});

describe("drawingDeleted", () => {
  it("treats a purged maze as deleted", () => {
    expect(drawingDeleted(null, ago(31 * DAY), NOW)).toBe(true);
  });

  it("keeps a maze nobody deleted, however old", () => {
    expect(drawingDeleted({ deletedAt: null }, ago(60 * DAY), NOW)).toBe(false);
  });

  it("keeps a deleted maze inside the window", () => {
    const m = { deletedAt: ago(DAY) };
    expect(drawingDeleted(m, ago(29 * DAY), NOW)).toBe(false);
  });

  it("drops a deleted maze once the window closes", () => {
    const m = { deletedAt: ago(DAY) };
    expect(drawingDeleted(m, ago(31 * DAY), NOW)).toBe(true);
  });
});
