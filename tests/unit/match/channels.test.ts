import { describe, expect, it } from "vitest";

import {
  isPresenceChannel,
  lobbyChannel,
  matchChannel,
  parseChannel,
  runChannel,
  userChannel,
} from "~/match";

const MATCH = "0794b64a-2899-48b1-b9a0-80fe4b4b59a2";
const USER = "n00PIhOWnzpwevDVa8MCWx162Oi9inDa";

describe("channel names", () => {
  it("round-trips a run channel", () => {
    const name = runChannel(MATCH, USER);
    expect(name).toBe(`presence-run_${MATCH}_${USER}`);
    expect(parseChannel(name)).toEqual({
      kind: "run",
      matchId: MATCH,
      runnerId: USER,
    });
    expect(isPresenceChannel(name)).toBe(true);
  });

  it("round-trips a match channel", () => {
    const name = matchChannel(MATCH);
    expect(name).toBe(`private-match_${MATCH}`);
    expect(parseChannel(name)).toEqual({ kind: "match", matchId: MATCH });
    expect(isPresenceChannel(name)).toBe(false);
  });

  it("round-trips the lobby channel", () => {
    expect(lobbyChannel()).toBe("private-lobby");
    expect(parseChannel(lobbyChannel())).toEqual({ kind: "lobby" });
    expect(isPresenceChannel(lobbyChannel())).toBe(false);
  });

  it("round-trips a user channel", () => {
    const name = userChannel("abc");
    expect(name).toBe("private-user_abc");
    expect(parseChannel(name)).toEqual({ kind: "user", userId: "abc" });
    expect(isPresenceChannel(name)).toBe(false);
  });

  it("rejects malformed lobby and user channels", () => {
    for (const name of [
      "private-user_",
      "private-user_a_b",
      "private-lobbyx",
    ]) {
      expect(parseChannel(name)).toBeNull();
    }
  });

  it("rejects anything else", () => {
    for (const name of [
      "",
      "presence-run_",
      `presence-run_${MATCH}`,
      `presence-run_${MATCH}_${USER}_extra`,
      `presence-run__${USER}`,
      "private-match_",
      `private-match_${MATCH}_x`,
      `public-${MATCH}`,
      MATCH,
    ]) {
      expect(parseChannel(name)).toBeNull();
    }
  });
});
