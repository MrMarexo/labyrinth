import { describe, expect, it } from "vitest";

import { holdsPlayer } from "~/match";

const now = new Date("2026-10-24T12:00:00Z");
const later = new Date("2026-10-25T12:00:00Z");
const earlier = new Date("2026-10-23T12:00:00Z");
const playing = { finishedAt: null, gaveUpAt: null, forfeitedAt: null };

describe("holdsPlayer", () => {
  it("holds a player while waiting, drawing or running", () => {
    for (const status of ["awaiting_opponent", "drawing", "running"] as const) {
      expect(holdsPlayer({ status, deadlineAt: later }, playing, now)).toBe(
        true,
      );
    }
  });

  it("lets a player go once their own run is over", () => {
    const match = { status: "running" as const, deadlineAt: later };
    expect(holdsPlayer(match, { ...playing, finishedAt: earlier }, now)).toBe(
      false,
    );
    expect(holdsPlayer(match, { ...playing, gaveUpAt: earlier }, now)).toBe(
      false,
    );
    expect(holdsPlayer(match, { ...playing, forfeitedAt: earlier }, now)).toBe(
      false,
    );
  });

  it("never holds a player in a match that is over", () => {
    for (const status of ["complete", "abandoned"] as const) {
      expect(holdsPlayer({ status, deadlineAt: later }, playing, now)).toBe(
        false,
      );
    }
  });

  it("does not count a match past its deadline", () => {
    expect(
      holdsPlayer({ status: "drawing", deadlineAt: earlier }, playing, now),
    ).toBe(false);
    expect(
      holdsPlayer({ status: "drawing", deadlineAt: now }, playing, now),
    ).toBe(false);
  });
});
