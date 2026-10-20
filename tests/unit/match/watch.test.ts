import { describe, expect, it } from "vitest";

import {
  MATCH_STATUSES,
  mayReplayOwn,
  maySubscribe,
  mayWatchOpponent,
  type WatchFacts,
} from "~/match";

const T = new Date("2026-01-01T00:00:00Z");

function facts(over: {
  status?: WatchFacts["status"];
  youSubmitted?: boolean;
  youFinished?: boolean;
  themSubmitted?: boolean;
  noOpponent?: boolean;
}): WatchFacts {
  return {
    status: over.status ?? "running",
    you: {
      userId: "me",
      submittedAt: over.youSubmitted === false ? null : T,
      finishedAt: over.youFinished ? T : null,
    },
    opponent: over.noOpponent
      ? null
      : {
          userId: "them",
          submittedAt: over.themSubmitted === false ? null : T,
        },
  };
}

describe("mayWatchOpponent — §8, watching opens when your run is over", () => {
  it("refuses while your own run is still going", () => {
    expect(mayWatchOpponent(facts({}))).toBe(false);
  });

  it("allows once you have found the treasure", () => {
    expect(mayWatchOpponent(facts({ youFinished: true }))).toBe(true);
  });

  it("allows once the match is over, whoever finished", () => {
    expect(mayWatchOpponent(facts({ status: "complete" }))).toBe(true);
    expect(mayWatchOpponent(facts({ status: "abandoned" }))).toBe(true);
  });

  it("refuses when either maze was never submitted, even after the end", () => {
    expect(
      mayWatchOpponent(facts({ status: "abandoned", themSubmitted: false })),
    ).toBe(false);
    expect(
      mayWatchOpponent(facts({ status: "abandoned", youSubmitted: false })),
    ).toBe(false);
    expect(
      mayWatchOpponent(facts({ status: "abandoned", noOpponent: true })),
    ).toBe(false);
  });
});

describe("mayReplayOwn — your run through their maze", () => {
  it("only once the match is over and both submitted", () => {
    expect(mayReplayOwn(facts({ youFinished: true }))).toBe(false);
    expect(mayReplayOwn(facts({ status: "complete" }))).toBe(true);
    expect(
      mayReplayOwn(facts({ status: "abandoned", themSubmitted: false })),
    ).toBe(false);
  });

  it("is never looser than watching the opponent", () => {
    for (const status of MATCH_STATUSES)
      for (const youFinished of [false, true])
        for (const themSubmitted of [false, true]) {
          const f = facts({ status, youFinished, themSubmitted });
          if (mayReplayOwn(f)) expect(mayWatchOpponent(f)).toBe(true);
        }
  });
});

describe("maySubscribe", () => {
  const run = (runnerId: string) =>
    ({ kind: "run", matchId: "m", runnerId }) as const;

  it("lets a runner join their own run channel at any time", () => {
    expect(maySubscribe(run("me"), facts({}))).toBe(true);
  });

  it("gates the opponent's run channel like watching", () => {
    expect(maySubscribe(run("them"), facts({}))).toBe(false);
    expect(maySubscribe(run("them"), facts({ youFinished: true }))).toBe(true);
  });

  it("refuses a run channel for someone not in the match", () => {
    expect(maySubscribe(run("stranger"), facts({ status: "complete" }))).toBe(
      false,
    );
  });

  it("lets both players join the match channel", () => {
    expect(maySubscribe({ kind: "match", matchId: "m" }, facts({}))).toBe(true);
  });
});
