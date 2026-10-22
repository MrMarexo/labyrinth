import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { HOURS_24_MS } from "~/match";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { match, matchPlayer, move } from "~/server/db/schema";

import { GATED_MAZE_ROUTE } from "../fixtures/maze";
import { runningMatch, signedIn } from "./players";
import { rejection } from "./support";

type Caller = ReturnType<typeof createCaller>;

async function walk(caller: Caller, matchId: string, dirs: readonly string[]) {
  const results = [];
  for (const [i, dir] of dirs.entries()) {
    results.push(
      await caller.run.move({
        matchId,
        seq: i + 1,
        dir: dir as "N" | "E" | "S" | "W",
      }),
    );
  }
  return results;
}

describe("run.get", () => {
  it("starts a runner on the origin, knowing only that", async () => {
    const { host, matchId } = await runningMatch();
    expect(await host.run.get({ matchId })).toEqual({
      status: "running",
      at: { x: 0, y: 0 },
      map: { cells: [{ x: 0, y: 0 }], segments: [], passages: [] },
      heldKeys: [],
      penalties: 0,
      moves: 0,
      nextSeq: 1,
      finished: false,
      gaveUp: false,
      elapsedMs: null,
    });
  });

  it("reports the runner's own time once they finish", async () => {
    const { host, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE.slice(0, -1));
    expect((await host.run.get({ matchId })).elapsedMs).toBeNull();
    await host.run.move({
      matchId,
      seq: GATED_MAZE_ROUTE.length,
      dir: GATED_MAZE_ROUTE.at(-1)!,
    });
    const finished = await host.run.get({ matchId });
    expect(finished.finished).toBe(true);
    expect(finished.elapsedMs).toEqual(expect.any(Number));
    expect(finished.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("lists the passages walked through, and not the bumps", async () => {
    const { host, matchId } = await runningMatch();
    await walk(host, matchId, ["S", "N", "N"]);
    expect((await host.run.get({ matchId })).map.passages).toEqual([
      { o: "H", x: 0, y: 0 },
    ]);
  });

  it("reads a run stored before passages were recorded", async () => {
    const { host, hostId, matchId } = await runningMatch();
    await walk(host, matchId, ["S"]);
    const where = and(
      eq(matchPlayer.matchId, matchId),
      eq(matchPlayer.userId, hostId),
    );
    const [player] = await db.select().from(matchPlayer).where(where);
    const stored = player!.runState!;
    const legacyMap = {
      cells: stored.view.map.cells,
      segments: stored.view.map.segments,
    };
    await db
      .update(matchPlayer)
      .set({
        runState: { ...stored, view: { ...stored.view, map: legacyMap } },
      } as never)
      .where(where);

    expect((await host.run.get({ matchId })).map.passages).toEqual([]);
    await host.run.move({ matchId, seq: 2, dir: "S" });
    expect((await host.run.get({ matchId })).map.passages).toEqual([
      { o: "H", x: 0, y: 1 },
    ]);
  });

  it("refuses someone who is not in the match", async () => {
    const { matchId } = await runningMatch();
    const stranger = createCaller(await signedIn());
    expect(await rejection(stranger.run.get({ matchId }))).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
  });
});

describe("run.move", () => {
  it("moves, writes the log, and keeps the cache in step", async () => {
    const { host, hostId, matchId } = await runningMatch();

    const [first] = await walk(host, matchId, ["S"]);

    expect(first).toEqual({
      delta: {
        outcome: "moved",
        from: { x: 0, y: 0 },
        at: { x: 0, y: 1 },
        penalties: 0,
        moves: 1,
        finished: false,
        revealedCell: { x: 0, y: 1 },
      },
      matchOver: false,
    });
    const rows = await db
      .select()
      .from(move)
      .where(and(eq(move.matchId, matchId), eq(move.runnerId, hostId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seq: 1, dir: "S", outcome: "moved" });
    const state = await host.run.get({ matchId });
    expect(state).toMatchObject({ at: { x: 0, y: 1 }, moves: 1, nextSeq: 2 });
  });

  it("charges a penalty for a wall, and reports what stopped you", async () => {
    const { host, matchId } = await runningMatch();
    const results = await walk(host, matchId, ["S", "S", "S"]);
    expect(results[2]!.delta).toMatchObject({
      outcome: "blocked_wall",
      penalties: 1,
      revealedSegment: { o: "H", x: 0, y: 2, kind: "wall" },
    });
    expect(await host.run.get({ matchId })).toMatchObject({
      heldKeys: [1],
      penalties: 1,
    });
  });

  it("stores a boundary bump as such, and sends the runner a wall", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const [result] = await walk(host, matchId, ["N"]);
    expect(result!.delta.outcome).toBe("blocked_wall");
    const [row] = await db
      .select()
      .from(move)
      .where(and(eq(move.matchId, matchId), eq(move.runnerId, hostId)));
    expect(row!.outcome).toBe("blocked_boundary");
    expect(row!.delta.outcome).toBe("blocked_wall");
  });

  it("sends a boundary bump and a wall bump that differ only in position", async () => {
    // Invariant 6, through the router: from (0,0), N is off the shape; from
    // (0,2), S is a wall. Strip the coordinates and nothing may differ.
    const { host, matchId } = await runningMatch();
    const results = await walk(host, matchId, ["N", "S", "S", "S"]);
    const strip = (d: (typeof results)[number]["delta"]) => ({
      outcome: d.outcome,
      kind: d.revealedSegment?.kind,
      keys: Object.keys(d).sort(),
      segmentKeys: Object.keys(d.revealedSegment ?? {}).sort(),
    });
    expect(strip(results[0]!.delta)).toEqual(strip(results[3]!.delta));
  });

  it("returns nothing but the delta, and maps only what was walked", async () => {
    const { host, matchId } = await runningMatch();
    // S, S (key), S (wall), E, E: stands on (0,0) (0,1) (0,2) (1,2) (2,2).
    const results = await walk(host, matchId, GATED_MAZE_ROUTE.slice(0, 5));
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(["delta", "matchOver"]);
    }
    const state = await host.run.get({ matchId });
    expect(state.map.cells.map((c) => `${c.x},${c.y}`).sort()).toEqual(
      ["0,0", "0,1", "0,2", "1,2", "2,2"].sort(),
    );
    expect(state.map.segments).toEqual([{ o: "H", x: 0, y: 2, kind: "wall" }]);
    // Not the treasure, and not the gate four columns east.
    const json = JSON.stringify(state);
    expect(json).not.toContain("treasure");
    expect(json).not.toContain('"gate"');
  });

  it("finishes the run, and only the run, on the treasure", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const results = await walk(host, matchId, GATED_MAZE_ROUTE);
    expect(results.at(-1)).toMatchObject({
      delta: { outcome: "moved_found_treasure", finished: true },
      matchOver: false,
    });
    const [player] = await db
      .select()
      .from(matchPlayer)
      .where(
        and(eq(matchPlayer.matchId, matchId), eq(matchPlayer.userId, hostId)),
      );
    expect(player!.finishedAt).not.toBeNull();
    expect(player!.startedAt).not.toBeNull();
    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row!.status).toBe("running");
    // §9.1 row 7: 24h from the finish.
    expect(row!.deadlineAt.getTime() - player!.finishedAt!.getTime()).toBe(
      HOURS_24_MS,
    );
  });

  it("completes the match when the second runner finishes", async () => {
    const { host, guest, hostId, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    // The guest bumps the north boundary first: one more penalty, so the
    // host wins on penalties regardless of timing.
    const results = await walk(guest, matchId, ["N", ...GATED_MAZE_ROUTE]);
    expect(results.at(-1)!.matchOver).toBe(true);
    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row).toMatchObject({
      status: "complete",
      endReason: "finished",
      winnerId: hostId,
    });
  });

  it("refuses a move once the runner has finished", async () => {
    const { host, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    expect(
      await rejection(
        host.run.move({ matchId, seq: GATED_MAZE_ROUTE.length + 1, dir: "N" }),
      ),
    ).toEqual({ code: "CONFLICT", message: "errors.runAlreadyFinished" });
  });

  it("returns the stored delta for a retried seq, and charges nothing", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const [first] = await walk(host, matchId, ["N"]);
    const again = await host.run.move({ matchId, seq: 1, dir: "N" });
    expect(again).toEqual(first);
    // A retry carrying a different direction still gets what seq 1 did.
    const different = await host.run.move({ matchId, seq: 1, dir: "S" });
    expect(different).toEqual(first);
    const rows = await db
      .select()
      .from(move)
      .where(and(eq(move.matchId, matchId), eq(move.runnerId, hostId)));
    expect(rows).toHaveLength(1);
    expect(await host.run.get({ matchId })).toMatchObject({ penalties: 1 });
  });

  it("replays the finishing move after the match completed", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    await walk(guest, matchId, GATED_MAZE_ROUTE);
    const replay = await host.run.move({
      matchId,
      seq: GATED_MAZE_ROUTE.length,
      dir: "S",
    });
    expect(replay).toMatchObject({
      delta: { outcome: "moved_found_treasure" },
      matchOver: true,
    });
  });

  it("two concurrent moves on one seq write one row", async () => {
    const { host, hostId, matchId } = await runningMatch();
    const [a, b] = await Promise.all([
      host.run.move({ matchId, seq: 1, dir: "N" }),
      host.run.move({ matchId, seq: 1, dir: "N" }),
    ]);
    expect(a).toEqual(b);
    const rows = await db
      .select()
      .from(move)
      .where(and(eq(move.matchId, matchId), eq(move.runnerId, hostId)));
    expect(rows).toHaveLength(1);
    expect(await host.run.get({ matchId })).toMatchObject({ penalties: 1 });
  });

  it("rejects a seq that is not next", async () => {
    const { host, matchId } = await runningMatch();
    expect(
      await rejection(host.run.move({ matchId, seq: 2, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.moveOutOfOrder" });
    await walk(host, matchId, ["S"]);
    expect(
      await rejection(host.run.move({ matchId, seq: 3, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.moveOutOfOrder" });
  });

  it("refuses a move before the runs unlock", async () => {
    const ctx = await signedIn();
    const host = createCaller(ctx);
    const created = await host.match.create({ cellCount: 36, gateCount: 1 });
    expect(
      await rejection(host.run.move({ matchId: created.id, seq: 1, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.runNotUnlocked" });
  });

  it("refuses a move after the deadline, before the sweep has run", async () => {
    const { host, matchId } = await runningMatch();
    await db
      .update(match)
      .set({ deadlineAt: new Date(Date.now() - 1000) })
      .where(eq(match.id, matchId));
    expect(
      await rejection(host.run.move({ matchId, seq: 1, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchExpired" });
  });

  it("refuses a move on a match that is over", async () => {
    const { host, matchId } = await runningMatch();
    await db
      .update(match)
      .set({ status: "abandoned", endReason: "abandoned" })
      .where(eq(match.id, matchId));
    expect(
      await rejection(host.run.move({ matchId, seq: 1, dir: "S" })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchOver" });
  });

  it("moves the deadline to row 6 on the first move, and row 5 once both move", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, ["S"]);
    let [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row!.deadlineAt.getTime() - row!.lastActivityAt.getTime()).toBe(
      HOURS_24_MS,
    );
    await walk(guest, matchId, ["S"]);
    [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row!.deadlineAt.getTime() - row!.lastActivityAt.getTime()).toBe(
      2 * HOURS_24_MS,
    );
  });
});
