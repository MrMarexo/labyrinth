import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";

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

describe("run.giveUp", () => {
  it("ends the match at once and gives the opponent the win", async () => {
    const { host, guestId, matchId } = await runningMatch();
    await walk(host, matchId, ["S"]);

    expect(await host.run.giveUp({ matchId })).toEqual({ status: "complete" });

    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row).toMatchObject({
      status: "complete",
      endReason: "forfeit",
      winnerId: guestId,
    });
  });

  it("gives the win even to an opponent who never moved", async () => {
    const { guest, hostId, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row!.winnerId).toBe(hostId);
  });

  it("stops the opponent's run", async () => {
    const { host, guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    expect(
      await rejection(host.run.move({ matchId, seq: 1, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchOver" });
  });

  it("refuses a runner who already found the treasure", async () => {
    const { host, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    expect(await rejection(host.run.giveUp({ matchId }))).toEqual({
      code: "CONFLICT",
      message: "errors.runAlreadyFinished",
    });
  });

  it("refuses after the deadline, so expiry cannot be turned into a win", async () => {
    const { host, matchId } = await runningMatch();
    await db
      .update(match)
      .set({ deadlineAt: new Date(Date.now() - 1000) })
      .where(eq(match.id, matchId));
    expect(await rejection(host.run.giveUp({ matchId }))).toEqual({
      code: "CONFLICT",
      message: "errors.matchExpired",
    });
  });

  it("refuses a match that is over", async () => {
    const { host, guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    expect(await rejection(host.run.giveUp({ matchId }))).toEqual({
      code: "CONFLICT",
      message: "errors.matchOver",
    });
  });
});

describe("run.result", () => {
  it("is refused while the match is running", async () => {
    const { host, matchId } = await runningMatch();
    expect(await rejection(host.run.result({ matchId }))).toEqual({
      code: "CONFLICT",
      message: "errors.resultNotReady",
    });
  });

  it("is refused to someone not in the match", async () => {
    const { guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    const stranger = createCaller(await signedIn());
    expect(await rejection(stranger.run.result({ matchId }))).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
  });

  it("reports a finished match from each side, with both paths", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    await walk(guest, matchId, ["N", ...GATED_MAZE_ROUTE]);

    const forHost = await host.run.result({ matchId });
    expect(forHost).toMatchObject({
      status: "complete",
      outcome: "won",
      reason: "treasure",
      gaveUpBy: null,
      decidedBy: "penalties",
      you: { penalties: 1, moves: 11, finished: true, gaveUp: false },
      opponent: { penalties: 2, moves: 12, finished: true },
    });
    expect(forHost.you.elapsedMs).not.toBeNull();

    // The gated seed starts at (0,0), so absolute and relative coincide; the
    // route visits 11 cells (10 moved moves plus the start). The bump adds
    // no point.
    const draft = gatedMazeDraft();
    expect(forHost.mazes!.theirs.maze.cells).toHaveLength(draft.cells.length);
    expect(forHost.mazes!.theirs.path).toHaveLength(11);
    expect(forHost.mazes!.theirs.path.at(-1)).toEqual({ x: 5, y: 5 });
    expect(forHost.mazes!.yours.path).toHaveLength(11);

    const forGuest = await guest.run.result({ matchId });
    expect(forGuest).toMatchObject({ outcome: "lost", reason: "treasure" });
    expect(forGuest.mazes!.theirs.path).toEqual(forHost.mazes!.yours.path);
  });

  it("calls equal bumps a draw, however many more moves one run took", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    // A detour south and back: two more moves, no more bumps.
    await walk(guest, matchId, ["S", "N", ...GATED_MAZE_ROUTE]);

    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row).toMatchObject({
      status: "complete",
      endReason: "finished",
      winnerId: null,
    });
    for (const caller of [host, guest]) {
      expect(await caller.run.result({ matchId })).toMatchObject({
        outcome: "none",
        reason: "tie",
        decidedBy: null,
      });
    }
    expect(await host.run.result({ matchId })).toMatchObject({
      you: { penalties: 1, moves: 11 },
      opponent: { penalties: 1, moves: 13 },
    });
  });

  it("names who gave up", async () => {
    const { host, guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    expect(await host.run.result({ matchId })).toMatchObject({
      outcome: "won",
      reason: "gaveUp",
      gaveUpBy: "opponent",
      decidedBy: null,
    });
    expect(await guest.run.result({ matchId })).toMatchObject({
      outcome: "lost",
      reason: "gaveUp",
      gaveUpBy: "you",
    });
  });

  it("reveals no maze for a match that never reached running", async () => {
    // Review Focus 3: the host drew and submitted; the guest never did. The
    // guest has not "faced" the host's maze (mazesFacedBy), so the host may
    // still reuse it against them — revealing it here would spoil that.
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const guest = createCaller(await signedIn());
    const created = await host.match.create({ cellCount: 36, gateCount: 1 });
    await guest.match.join({ code: created.code });
    const draft = await host.maze.createDraft({
      name: "Mine",
      cellCount: 36,
      gateCount: 1,
    });
    await host.maze.saveDraft({
      id: draft.id,
      data: gatedMazeDraft(),
      expectedVersion: 0,
    });
    await host.match.submitMaze({ matchId: created.id, mazeId: draft.id });
    await db
      .update(match)
      .set({ status: "abandoned", endReason: "abandoned" })
      .where(eq(match.id, created.id));

    const result = await guest.run.result({ matchId: created.id });
    expect(result).toMatchObject({
      status: "abandoned",
      outcome: "none",
      reason: "abandoned",
      mazes: null,
    });
  });

  it("calls a forfeit after a finish a timeout", async () => {
    const { host, guest, hostId, guestId, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    // What the sweep writes for §9.1 row 7.
    await db
      .update(match)
      .set({ status: "complete", endReason: "forfeit", winnerId: hostId })
      .where(eq(match.id, matchId));
    await db
      .update(matchPlayer)
      .set({ forfeitedAt: new Date() })
      .where(
        and(eq(matchPlayer.matchId, matchId), eq(matchPlayer.userId, guestId)),
      );
    expect(await guest.run.result({ matchId })).toMatchObject({
      outcome: "lost",
      reason: "timeout",
      you: { timedOut: true },
    });
  });
});
