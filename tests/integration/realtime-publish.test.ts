import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EVENTS, matchChannel, runChannel } from "~/match";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { match, move } from "~/server/db/schema";
import { closeIfExpired } from "~/server/match/sweep";
import { swapPublisherForTests } from "~/server/realtime";

import {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  GATED_MAZE_ROUTE,
  gatedMazeDraft,
} from "../fixtures/maze";
import { runningMatch, signedIn } from "./players";
import { sweepAll } from "./support";

type Event = { channel: string; event: string; data: unknown };
let events: Event[] = [];
let restore: () => void = () => undefined;

beforeEach(() => {
  events = [];
  restore = swapPublisherForTests({
    async publish(channel, event, data) {
      events.push({ channel, event, data });
    },
  });
});
afterEach(() => restore());

const on = (channel: string) => events.filter((e) => e.channel === channel);

describe("publishing", () => {
  it("publishes each new move on the runner's channel", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const result = await host.run.move({ matchId, seq: 1, dir: "S" });
    expect(on(runChannel(matchId, hostId))).toEqual([
      {
        channel: runChannel(matchId, hostId),
        event: EVENTS.move,
        data: { seq: 1, delta: result.delta },
      },
    ]);
  });

  it("publishes nothing for a retried seq", async () => {
    const { host, hostId, matchId } = await runningMatch();
    await host.run.move({ matchId, seq: 1, dir: "S" });
    events = [];
    await host.run.move({ matchId, seq: 1, dir: "S" });
    expect(on(runChannel(matchId, hostId))).toEqual([]);
  });

  it("pings the match once when each run finishes", async () => {
    const { host, guest, matchId } = await runningMatch();
    const ping = {
      channel: matchChannel(matchId),
      event: EVENTS.changed,
      data: {},
    };
    events = [];
    // The first finish does not end the match, but a watcher still needs
    // telling: the move event alone may be dropped.
    for (const [i, dir] of GATED_MAZE_ROUTE.entries()) {
      await host.run.move({ matchId, seq: i + 1, dir });
    }
    expect(on(matchChannel(matchId))).toEqual([ping]);
    // The second finish both finishes a run and ends the match: one ping.
    for (const [i, dir] of GATED_MAZE_ROUTE.entries()) {
      await guest.run.move({ matchId, seq: i + 1, dir });
    }
    expect(on(matchChannel(matchId))).toEqual([ping, ping]);
  });

  it("pings the match on a give-up", async () => {
    const { guest, matchId } = await runningMatch();
    events = [];
    await guest.run.giveUp({ matchId });
    expect(on(matchChannel(matchId))).toHaveLength(1);
  });

  it("pings the match on join and on each submission", async () => {
    const host = createCaller(await signedIn());
    const guest = createCaller(await signedIn());
    const settings = {
      cellCount: GATED_MAZE_CELL_COUNT,
      gateCount: GATED_MAZE_GATE_COUNT,
    } as const;
    const created = await host.match.create(settings);
    await guest.match.join({ matchId: created.id });
    expect(on(matchChannel(created.id))).toHaveLength(1);

    const draft = await host.maze.createDraft({ name: "M", ...settings });
    await host.maze.saveDraft({
      id: draft.id,
      data: gatedMazeDraft(),
      expectedVersion: 0,
    });
    await host.match.submitMaze({ matchId: created.id, mazeId: draft.id });
    expect(on(matchChannel(created.id))).toHaveLength(2);
  });

  it("closing an expired match publishes nothing by itself", async () => {
    const { host, matchId } = await runningMatch();
    await host.run.move({ matchId, seq: 1, dir: "S" });
    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    events = [];
    expect(
      await closeIfExpired(
        db,
        matchId,
        new Date(row!.deadlineAt.getTime() + 1),
      ),
    ).toBe(true);
    // The sweep publishes for the whole batch at once, after its loop.
    expect(events).toEqual([]);
  });

  it("pings the match when the sweep closes it", async () => {
    const { host, matchId } = await runningMatch();
    await host.run.move({ matchId, seq: 1, dir: "S" });
    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    events = [];
    // Other suites' due matches in the shared database are pinged too.
    await sweepAll(db, new Date(row!.deadlineAt.getTime() + 1));
    expect(on(matchChannel(matchId))).toEqual([
      { channel: matchChannel(matchId), event: EVENTS.changed, data: {} },
    ]);
  });

  it("a publisher that throws does not fail the move", async () => {
    restore();
    restore = swapPublisherForTests({
      async publish() {
        throw new Error("pusher is down");
      },
    });
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { host, hostId, matchId } = await runningMatch();
    const result = await host.run.move({ matchId, seq: 1, dir: "S" });
    expect(result.delta.outcome).toBe("moved");
    const rows = await db.select().from(move).where(eq(move.matchId, matchId));
    expect(rows.filter((r) => r.runnerId === hostId)).toHaveLength(1);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe("match.get channels", () => {
  it("names the match channel and your own run channel only", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const got = await host.match.get({ id: matchId });
    expect(got.channels).toEqual({
      match: matchChannel(matchId),
      yourRun: runChannel(matchId, hostId),
    });
  });
});

describe("publishing a cancel", () => {
  it("pings the match once the cancel has committed", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create({ cellCount: 36, gateCount: 0 });
    events = [];

    await host.match.cancel({ matchId: created.id });

    expect(on(matchChannel(created.id))).toEqual([
      { channel: matchChannel(created.id), event: EVENTS.changed, data: {} },
    ]);
  });
});
