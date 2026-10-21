import { describe, expect, it } from "vitest";

import { initialPlayback, playback, tickMs } from "~/maze/playback";

describe("initialPlayback", () => {
  it("starts a finished replay at the beginning, paused", () => {
    expect(initialPlayback(11, false)).toEqual({
      step: 0,
      length: 11,
      playing: false,
      speed: 1,
      live: false,
      following: false,
    });
  });

  it("starts a live view at the newest move, following", () => {
    expect(initialPlayback(5, true)).toMatchObject({
      step: 5,
      following: true,
    });
  });
});

describe("playback", () => {
  it("steps forward on each tick and stops at the end", () => {
    let s = playback(initialPlayback(2, false), { type: "play" });
    s = playback(s, { type: "tick" });
    expect(s.step).toBe(1);
    s = playback(s, { type: "tick" });
    expect(s).toMatchObject({ step: 2, playing: true });
    s = playback(s, { type: "tick" });
    expect(s).toMatchObject({ step: 2, playing: false });
  });

  it("restarts a finished replay from the beginning on play", () => {
    const atEnd = playback(initialPlayback(3, false), {
      type: "scrub",
      step: 3,
    });
    expect(playback(atEnd, { type: "play" })).toMatchObject({
      step: 0,
      playing: true,
    });
  });

  it("follows new moves while at the live edge", () => {
    const s = playback(initialPlayback(5, true), {
      type: "arrived",
      length: 6,
      live: true,
    });
    expect(s).toMatchObject({ step: 6, length: 6, following: true });
  });

  it("stays put when scrubbed back, and jumps on request", () => {
    let s = playback(initialPlayback(5, true), { type: "scrub", step: 2 });
    expect(s.following).toBe(false);
    s = playback(s, { type: "arrived", length: 7, live: true });
    expect(s).toMatchObject({ step: 2, length: 7, following: false });
    s = playback(s, { type: "jumpToLive" });
    expect(s).toMatchObject({ step: 7, following: true });
  });

  it("follows again once a scrub reaches the live edge", () => {
    const back = playback(initialPlayback(5, true), { type: "scrub", step: 1 });
    expect(playback(back, { type: "scrub", step: 5 }).following).toBe(true);
  });

  it("never shrinks the timeline or scrubs past it", () => {
    let s = initialPlayback(5, true);
    s = playback(s, { type: "arrived", length: 3, live: true });
    expect(s.length).toBe(5);
    s = playback(s, { type: "scrub", step: 40 });
    expect(s.step).toBe(5);
    s = playback(s, { type: "scrub", step: -2 });
    expect(s.step).toBe(0);
  });

  it("stops following when the run ends", () => {
    const s = playback(initialPlayback(5, true), {
      type: "arrived",
      length: 6,
      live: false,
    });
    expect(s).toMatchObject({ step: 6, live: false, following: false });
  });

  it("steps by one in either direction", () => {
    const mid = playback(initialPlayback(5, false), { type: "scrub", step: 2 });
    expect(playback(mid, { type: "step", by: 1 }).step).toBe(3);
    expect(playback(mid, { type: "step", by: -1 }).step).toBe(1);
  });

  it("clamps a step at both ends of the timeline", () => {
    const start = initialPlayback(5, false);
    expect(playback(start, { type: "step", by: -1 }).step).toBe(0);
    const end = playback(start, { type: "scrub", step: 5 });
    expect(playback(end, { type: "step", by: 1 }).step).toBe(5);
  });

  it("stops following on a step back and follows again at the live edge", () => {
    const back = playback(initialPlayback(5, true), { type: "step", by: -1 });
    expect(back).toMatchObject({ step: 4, following: false });
    const edge = playback(back, { type: "step", by: 1 });
    expect(edge).toMatchObject({ step: 5, following: true });
    expect(playback(edge, { type: "step", by: 1 })).toMatchObject({
      step: 5,
      following: true,
    });
  });

  it("ticks four moves a second at 1×", () => {
    expect(tickMs(1)).toBe(250);
    expect(tickMs(8)).toBe(31.25);
  });
});
