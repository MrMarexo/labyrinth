import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { HOURS_24_MS, HOURS_48_MS } from "~/match";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";
import { sweepExpiredMatches } from "~/server/match/sweep";

import {
  SOLVABLE_MAZE_CELL_COUNT,
  SOLVABLE_MAZE_GATE_COUNT,
  solvableDraft,
} from "../fixtures/maze";

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
  const created = await caller.maze.createDraft({ name, ...settings });
  await caller.maze.saveDraft({ id: created.id, data: solvableDraft() });
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

    await sweepExpiredMatches(db, later(HOURS_24_MS + 1000));

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
    await createCaller(await signedIn()).match.join({ code: created.code });

    await sweepExpiredMatches(db, later(HOURS_48_MS + 1000));

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
    await createCaller(guestCtx).match.join({ code: created.code });
    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "Drew it"),
    });

    await sweepExpiredMatches(db, later(HOURS_24_MS + 1000));

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
    await guest.match.join({ code: created.code });
    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "Host"),
    });
    await guest.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(guest, "Guest"),
    });

    await sweepExpiredMatches(db, later(HOURS_24_MS + 1000));

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("abandoned");
    expect(row?.winnerId).toBeNull();
  });

  it("never touches a match that has already ended", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.match.create(settings);
    await sweepExpiredMatches(db, later(HOURS_24_MS + 1000));
    const [first] = await db
      .select()
      .from(match)
      .where(eq(match.id, created.id));

    await sweepExpiredMatches(db, later(HOURS_48_MS * 10));

    const [second] = await db
      .select()
      .from(match)
      .where(eq(match.id, created.id));
    expect(second).toEqual(first);
  });

  it("reports how many it closed", async () => {
    const caller = createCaller(await signedIn());
    await caller.match.create(settings);
    await caller.match.create(settings);

    const result = await sweepExpiredMatches(db, later(HOURS_24_MS + 1000));
    expect(result.closed).toBeGreaterThanOrEqual(2);
  });
});
