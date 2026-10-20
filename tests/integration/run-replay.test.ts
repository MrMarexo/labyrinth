import { describe, expect, it } from "vitest";

import { runChannel, matchChannel } from "~/match";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { canSubscribe } from "~/server/realtime/access";

import { GATED_MAZE_ROUTE, gatedMazeDraft } from "../fixtures/maze";
import { runningMatch, signedIn } from "./players";
import { rejection } from "./support";

type Caller = ReturnType<typeof createCaller>;

async function walk(caller: Caller, matchId: string, dirs: readonly string[]) {
  for (const [i, dir] of dirs.entries()) {
    await caller.run.move({
      matchId,
      seq: i + 1,
      dir: dir as "N" | "E" | "S" | "W",
    });
  }
}

describe("run.replay", () => {
  it("refuses to show the opponent's run before your own is over", async () => {
    const { host, matchId } = await runningMatch();
    expect(
      await rejection(host.run.replay({ matchId, whose: "opponent" })),
    ).toEqual({ code: "CONFLICT", message: "errors.watchNotYet" });
  });

  it("shows the opponent's run through your maze, live, once you finish", async () => {
    const { host, guest, guestId, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    await walk(guest, matchId, ["S", "S"]);

    const replay = await host.run.replay({ matchId, whose: "opponent" });

    expect(replay.live).toBe(true);
    expect(replay.channel).toBe(runChannel(matchId, guestId));
    expect(replay.moves.map((m) => m.seq)).toEqual([1, 2]);
    expect(replay.moves[1]!.delta.at).toEqual({ x: 0, y: 2 });
    // The host's own maze: the gated seed they submitted.
    expect(replay.maze.cells).toHaveLength(gatedMazeDraft().cells.length);
    expect(replay.runnerName).toBe("Test Person");
  });

  it("stops being live once the runner finishes", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    await walk(guest, matchId, GATED_MAZE_ROUTE);
    const replay = await host.run.replay({ matchId, whose: "opponent" });
    expect(replay).toMatchObject({ live: false, channel: null });
    expect(replay.moves).toHaveLength(GATED_MAZE_ROUTE.length);
  });

  it("refuses your own run until the match is over, then allows it", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    expect(
      await rejection(host.run.replay({ matchId, whose: "mine" })),
    ).toEqual({ code: "CONFLICT", message: "errors.replayNotReady" });
    await guest.run.giveUp({ matchId });
    const mine = await host.run.replay({ matchId, whose: "mine" });
    expect(mine.live).toBe(false);
    expect(mine.moves).toHaveLength(GATED_MAZE_ROUTE.length);
    // Both test users share a name, so this proves only that it is returned.
    expect(mine.authorName).toBe("Test Person");
  });

  it("refuses someone not in the match", async () => {
    const { guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    const stranger = createCaller(await signedIn());
    expect(
      await rejection(stranger.run.replay({ matchId, whose: "opponent" })),
    ).toEqual({ code: "FORBIDDEN", message: "errors.notYourMatch" });
  });
});

describe("canSubscribe", () => {
  it("applies the watching gate to run channels", async () => {
    const { host, hostId, guestId, matchId } = await runningMatch();
    expect(await canSubscribe(db, hostId, runChannel(matchId, hostId))).toBe(
      true,
    );
    expect(await canSubscribe(db, hostId, runChannel(matchId, guestId))).toBe(
      false,
    );
    await walk(host, matchId, GATED_MAZE_ROUTE);
    expect(await canSubscribe(db, hostId, runChannel(matchId, guestId))).toBe(
      true,
    );
  });

  it("admits both players, and only them, to the match channel", async () => {
    const { hostId, guestId, matchId } = await runningMatch();
    const strangerCtx = await signedIn();
    expect(await canSubscribe(db, hostId, matchChannel(matchId))).toBe(true);
    expect(await canSubscribe(db, guestId, matchChannel(matchId))).toBe(true);
    expect(
      await canSubscribe(
        db,
        strangerCtx.session!.user.id,
        matchChannel(matchId),
      ),
    ).toBe(false);
  });

  it("refuses a malformed or unknown channel", async () => {
    const { hostId } = await runningMatch();
    expect(await canSubscribe(db, hostId, "presence-run_nope")).toBe(false);
    expect(
      await canSubscribe(db, hostId, matchChannel(crypto.randomUUID())),
    ).toBe(false);
  });
});
