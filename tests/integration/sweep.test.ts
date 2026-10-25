import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { HOURS_24_MS, HOURS_48_MS } from "~/match";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";
import { closeIfExpired, sweepExpiredMatches } from "~/server/match/sweep";

import { GATED_MAZE_ROUTE } from "../fixtures/maze";
import {
  SOLVABLE_MAZE_CELL_COUNT,
  SOLVABLE_MAZE_GATE_COUNT,
  solvableDraft,
} from "../fixtures/maze";
import { runningMatch } from "./players";
import { sweepAll } from "./support";

async function signedIn() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

const settings = {
  cellCount: SOLVABLE_MAZE_CELL_COUNT,
  gateCount: SOLVABLE_MAZE_GATE_COUNT,
};

async function savedMaze(
  caller: ReturnType<typeof createCaller>,
  name: string,
) {
  const created = await caller.maze.createConcept({
    name,
    ...settings,
    replace: true,
  });
  await caller.maze.saveDraft({
    id: created.id,
    data: solvableDraft(),
    expectedVersion: 0,
  });
  return created.id;
}

const later = (ms: number) => new Date(Date.now() + ms);

describe("sweepExpiredMatches", () => {
  it("leaves a match alone before its deadline", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.match.create(settings);

    await sweepExpiredMatches(db, new Date());

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("awaiting_opponent");
    expect(row?.endReason).toBeNull();
  });

  it("abandons an unjoined match with no winner and nobody at fault", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.match.create(settings);

    await sweepAll(db, later(HOURS_24_MS + 1000));

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("abandoned");
    expect(row?.endReason).toBe("abandoned");
    expect(row?.winnerId).toBeNull();
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    expect(players.every((p) => p.forfeitedAt === null)).toBe(true);
  });

  it("abandons a drawing match where neither player drew, blaming neither", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });

    await sweepAll(db, later(HOURS_48_MS + 1000));

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("abandoned");
    expect(row?.winnerId).toBeNull();
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    expect(players.every((p) => p.forfeitedAt === null)).toBe(true);
  });

  it("records the drawing forfeit against the player who did not draw, and still gives nobody the win", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    const guestCtx = await signedIn();
    await createCaller(guestCtx).match.join({ matchId: created.id });
    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "Drew it"),
    });

    await sweepAll(db, later(HOURS_24_MS + 1000));

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    // The player who drew does NOT win. This is the spec's load-bearing
    // principle: you cannot win without finding the treasure, and nobody
    // has yet.
    expect(row?.status).toBe("abandoned");
    expect(row?.endReason).toBe("abandoned");
    expect(row?.winnerId).toBeNull();

    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    const host_ = players.find((p) => p.userId === hostCtx.session!.user.id);
    const guest_ = players.find((p) => p.userId === guestCtx.session!.user.id);
    expect(host_?.forfeitedAt).toBeNull();
    expect(guest_?.forfeitedAt).not.toBeNull();
  });

  it("abandons a running match where neither player moved", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());
    await guest.match.join({ matchId: created.id });
    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "Host"),
    });
    await guest.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(guest, "Guest"),
    });

    await sweepAll(db, later(HOURS_24_MS + 1000));

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("abandoned");
    expect(row?.winnerId).toBeNull();
  });

  it("never touches a match that has already ended", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.match.create(settings);
    await sweepAll(db, later(HOURS_24_MS + 1000));
    const [first] = await db
      .select()
      .from(match)
      .where(eq(match.id, created.id));

    await sweepAll(db, later(HOURS_48_MS * 10));

    const [second] = await db
      .select()
      .from(match)
      .where(eq(match.id, created.id));
    expect(second).toEqual(first);
  });

  it("closes each of several overdue matches it created, identified by id", async () => {
    // `result.closed` is a count against the whole shared table, which other
    // suites in the same run also populate — asserting a bound on it would
    // pass even if the sweep closed every open match indiscriminately. What
    // actually matters is that these two specific matches ended up closed.
    // One waiting match per creator, so each match gets its own.
    const a = await createCaller(await signedIn()).match.create(settings);
    const b = await createCaller(await signedIn()).match.create(settings);

    await sweepAll(db, later(HOURS_24_MS + 1000));

    const rows = await db
      .select()
      .from(match)
      .where(inArray(match.id, [a.id, b.id]));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "abandoned")).toBe(true);
  });

  it("closes only the match whose deadline has passed, leaving a not-yet-due one alone", async () => {
    // One waiting match per creator, so each match gets its own.
    const overdue = await createCaller(await signedIn()).match.create(settings);
    const notYetDue = await createCaller(await signedIn()).match.create(
      settings,
    );

    // Row 1 of §9.1 recomputes its deadline from createdAt + 24h inside
    // resolveExpiry itself — it does not trust the stored deadlineAt column
    // — so both have to be backdated together for the domain layer to agree
    // this match is actually overdue, not just the column the SQL candidate
    // query reads.
    const createdAt = new Date(Date.now() - (HOURS_24_MS + 1000));
    await db
      .update(match)
      .set({
        createdAt,
        lastActivityAt: createdAt,
        deadlineAt: new Date(Date.now() - 1000),
      })
      .where(eq(match.id, overdue.id));

    await sweepAll(db, new Date());

    const rows = await db
      .select()
      .from(match)
      .where(inArray(match.id, [overdue.id, notYetDue.id]));
    const overdueRow = rows.find((r) => r.id === overdue.id);
    const notYetDueRow = rows.find((r) => r.id === notYetDue.id);
    expect(overdueRow?.status).toBe("abandoned");
    expect(notYetDueRow?.status).toBe("awaiting_opponent");
  });

  it("gives the finisher the win once the other runner's 24h is up", async () => {
    const { host, hostId, guestId, matchId } = await runningMatch();
    for (const [i, dir] of GATED_MAZE_ROUTE.entries()) {
      await host.run.move({ matchId, seq: i + 1, dir });
    }
    const [row] = await db.select().from(match).where(eq(match.id, matchId));

    await sweepAll(db, new Date(row!.deadlineAt.getTime() + 1));

    const [after] = await db.select().from(match).where(eq(match.id, matchId));
    expect(after).toMatchObject({
      status: "complete",
      endReason: "forfeit",
      winnerId: hostId,
    });
    const [guestRow] = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.userId, guestId));
    expect(guestRow!.forfeitedAt).not.toBeNull();
  });

  it("abandons a one-mover match on row 6, blaming the one who never moved", async () => {
    const { host, guestId, hostId, matchId } = await runningMatch();
    await host.run.move({ matchId, seq: 1, dir: "S" });
    const [row] = await db.select().from(match).where(eq(match.id, matchId));

    await sweepAll(db, new Date(row!.deadlineAt.getTime() + 1));

    const [after] = await db.select().from(match).where(eq(match.id, matchId));
    expect(after).toMatchObject({ status: "abandoned", winnerId: null });
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, matchId));
    expect(
      players.find((p) => p.userId === guestId)!.forfeitedAt,
    ).not.toBeNull();
    expect(players.find((p) => p.userId === hostId)!.forfeitedAt).toBeNull();
  });

  it("re-reads under lock, so a match a move just completed is left alone", async () => {
    const { host, guest, hostId, matchId } = await runningMatch();
    for (const [i, dir] of GATED_MAZE_ROUTE.entries()) {
      await host.run.move({ matchId, seq: i + 1, dir });
    }
    for (const [i, dir] of ["N", ...GATED_MAZE_ROUTE].entries()) {
      await guest.run.move({
        matchId,
        seq: i + 1,
        dir: dir as "N" | "E" | "S" | "W",
      });
    }
    const [done] = await db.select().from(match).where(eq(match.id, matchId));
    expect(done!.status).toBe("complete");

    const closed = await closeIfExpired(
      db,
      matchId,
      new Date(done!.deadlineAt.getTime() + 1),
    );

    expect(closed).toBe(false);
    const [after] = await db.select().from(match).where(eq(match.id, matchId));
    expect(after).toMatchObject({
      status: "complete",
      endReason: "finished",
      winnerId: hostId,
    });
  });
});
