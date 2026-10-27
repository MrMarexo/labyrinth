import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { match, matchPlayer, maze, user } from "~/server/db/schema";
import { purgeIdleGuests } from "~/server/guest/purge";
import { purgeDeletedMazes } from "~/server/maze/purge";

import {
  SOLVABLE_MAZE_CELL_COUNT,
  SOLVABLE_MAZE_GATE_COUNT,
  solvableDraft,
} from "../fixtures/maze";
import { guestSignedIn, signedIn } from "./players";

type Caller = ReturnType<typeof createCaller>;

const DAY = 24 * 60 * 60 * 1000;
const settings = {
  cellCount: SOLVABLE_MAZE_CELL_COUNT,
  gateCount: SOLVABLE_MAZE_GATE_COUNT,
};

/**
 * Purges until nothing is left to purge. The test database is shared and
 * never reset, so other suites' deleted mazes may fill the first batches.
 */
async function purgeAll(at = new Date()) {
  for (;;) {
    const { capped } = await purgeDeletedMazes(db, at);
    if (!capped) return;
  }
}

async function player() {
  const ctx = await signedIn();
  return { caller: createCaller(ctx), id: ctx.session!.user.id };
}

async function savedMaze(caller: Caller, name: string) {
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

/** `author` plays `mazeId` against a fresh rival; the match is running. */
async function playWith(author: Caller, mazeId: string) {
  const rival = await player();
  const created = await author.match.create(settings);
  await rival.caller.match.join({ matchId: created.id });
  await author.match.submitMaze({ matchId: created.id, mazeId });
  await rival.caller.match.submitMaze({
    matchId: created.id,
    mazeId: await savedMaze(rival.caller, "Rival's"),
  });
  return { matchId: created.id, rival: rival.caller };
}

/** Ends a running match by the rival giving up, `days` ago. */
async function endAgo(rival: Caller, matchId: string, days: number) {
  await rival.run.giveUp({ matchId });
  await db
    .update(match)
    .set({ endedAt: new Date(Date.now() - days * DAY) })
    .where(eq(match.id, matchId));
}

async function exists(mazeId: string) {
  const rows = await db.select().from(maze).where(eq(maze.id, mazeId));
  return rows.length === 1;
}

describe("purgeDeletedMazes", () => {
  it("removes a deleted maze once its only match is past the window, and unlinks it", async () => {
    const author = await player();
    const mazeId = await savedMaze(author.caller, "Old");
    const { matchId, rival } = await playWith(author.caller, mazeId);
    await endAgo(rival, matchId, 31);
    await author.caller.maze.remove({ id: mazeId });

    await purgeAll();

    expect(await exists(mazeId)).toBe(false);
    const [seat] = await db
      .select({ mazeId: matchPlayer.mazeId })
      .from(matchPlayer)
      .where(
        and(
          eq(matchPlayer.matchId, matchId),
          eq(matchPlayer.userId, author.id),
        ),
      );
    expect(seat!.mazeId).toBeNull();

    // The result survives, with the purged side's drawing gone.
    const result = await author.caller.run.result({ matchId });
    expect(result.outcome).toBe("won");
    expect(result.mazes?.yours).toBeNull();
    expect(result.mazes?.theirs).not.toBeNull();
  });

  it("keeps a deleted maze whose match ended inside the window", async () => {
    const author = await player();
    const mazeId = await savedMaze(author.caller, "Recent");
    const { matchId, rival } = await playWith(author.caller, mazeId);
    await endAgo(rival, matchId, 29);
    await author.caller.maze.remove({ id: mazeId });

    await purgeAll();

    expect(await exists(mazeId)).toBe(true);
  });

  it("keeps a deleted maze a match is still being played on", async () => {
    const author = await player();
    const mazeId = await savedMaze(author.caller, "Live");
    await playWith(author.caller, mazeId);
    await author.caller.maze.remove({ id: mazeId });

    await purgeAll();

    expect(await exists(mazeId)).toBe(true);
  });

  it("waits for the most recent of several matches that used the maze", async () => {
    const author = await player();
    const mazeId = await savedMaze(author.caller, "Reused");
    const first = await playWith(author.caller, mazeId);
    await endAgo(first.rival, first.matchId, 40);
    const second = await playWith(author.caller, mazeId);
    await endAgo(second.rival, second.matchId, 5);
    await author.caller.maze.remove({ id: mazeId });

    await purgeAll();

    expect(await exists(mazeId)).toBe(true);
  });

  it("never removes a maze nobody deleted, however old its match", async () => {
    const author = await player();
    const mazeId = await savedMaze(author.caller, "Kept");
    const { matchId, rival } = await playWith(author.caller, mazeId);
    await endAgo(rival, matchId, 400);

    await purgeAll();

    expect(await exists(mazeId)).toBe(true);
  });
});

describe("purgeDeletedMazes for a guest's maze", () => {
  it("removes it once the match ended 30 days ago and keeps both seats", async () => {
    const member = await player();
    const guestCtx = await guestSignedIn();
    const guest = createCaller(guestCtx);
    const guestId = guestCtx.session!.user.id;
    const created = await member.caller.match.create(settings);
    await guest.match.join({ matchId: created.id });
    await member.caller.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(member.caller, "Host's"),
    });
    const concept = await guest.maze.conceptForMatch({
      matchId: created.id,
      name: "Guest's",
      replace: true,
    });
    await guest.maze.saveDraft({
      id: concept.id,
      data: solvableDraft(),
      expectedVersion: 0,
    });
    await guest.match.submitMaze({ matchId: created.id, mazeId: concept.id });
    await endAgo(member.caller, created.id, 31);

    await purgeAll();

    expect(await exists(concept.id)).toBe(false);
    const seats = await db
      .select({ userId: matchPlayer.userId, mazeId: matchPlayer.mazeId })
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    expect(seats).toHaveLength(2);
    expect(seats.find((s) => s.userId === guestId)?.mazeId).toBeNull();
  });
});

describe("purgeIdleGuests", () => {
  async function aged(id: string, days: number) {
    await db
      .update(user)
      .set({ createdAt: new Date(Date.now() - days * DAY) })
      .where(eq(user.id, id));
    return id;
  }
  async function present(id: string) {
    return (await db.select().from(user).where(eq(user.id, id))).length === 1;
  }

  it("deletes only idle guests past 30 days", async () => {
    const idle = await aged((await guestSignedIn()).session!.user.id, 31);
    const young = await aged((await guestSignedIn()).session!.user.id, 29);
    const member = await aged((await signedIn()).session!.user.id, 31);
    const seated = await aged((await guestSignedIn()).session!.user.id, 31);
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await db
      .insert(matchPlayer)
      .values({ matchId: created.id, userId: seated });

    for (;;) {
      const { capped } = await purgeIdleGuests(db, new Date());
      if (!capped) break;
    }

    expect(await present(idle)).toBe(false);
    expect(await present(young)).toBe(true);
    expect(await present(member)).toBe(true);
    expect(await present(seated)).toBe(true);
  });
});
