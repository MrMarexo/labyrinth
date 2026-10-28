import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { match, matchMaze, matchPlayer, maze, user } from "~/server/db/schema";
import { purgeIdleGuests } from "~/server/guest/purge";
import { purgeMatchMazes } from "~/server/match/purge";

import {
  SOLVABLE_MAZE_CELL_COUNT,
  SOLVABLE_MAZE_GATE_COUNT,
  solvableDraft,
} from "../fixtures/maze";
import { guestSignedIn, signedIn } from "./players";

type Caller = ReturnType<typeof createCaller>;
type Draft = ReturnType<typeof solvableDraft>;

const DAY = 24 * 60 * 60 * 1000;
const settings = {
  cellCount: SOLVABLE_MAZE_CELL_COUNT,
  gateCount: SOLVABLE_MAZE_GATE_COUNT,
};

/**
 * Purges until nothing is left to purge. The test database is shared and
 * never reset, so other suites' old matches may fill the first batches.
 */
async function purgeAll(at = new Date()) {
  for (;;) {
    const { capped } = await purgeMatchMazes(db, at);
    if (!capped) return;
  }
}

async function player() {
  const ctx = await signedIn();
  return { caller: createCaller(ctx), id: ctx.session!.user.id };
}

async function savedMaze(caller: Caller, name: string, data = solvableDraft()) {
  const created = await caller.maze.createConcept({
    name,
    ...settings,
    replace: true,
  });
  await caller.maze.saveDraft({ id: created.id, data, expectedVersion: 0 });
  return created.id;
}

/**
 * `author` plays `mazeId` against a fresh rival; the match is running. A
 * later rival must draw something else: `author` has faced the first one's.
 */
async function playWith(author: Caller, mazeId: string, rivalDraft?: Draft) {
  const rival = await player();
  const created = await author.match.create(settings);
  await rival.caller.match.join({ matchId: created.id });
  await author.match.submitMaze({ matchId: created.id, mazeId });
  await rival.caller.match.submitMaze({
    matchId: created.id,
    mazeId: await savedMaze(rival.caller, "Rival's", rivalDraft),
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

/** Whose copies of their mazes the match still holds. */
async function copiesIn(matchId: string) {
  const rows = await db
    .select({ userId: matchMaze.userId })
    .from(matchMaze)
    .where(eq(matchMaze.matchId, matchId));
  return rows.map((r) => r.userId).sort();
}

describe("purgeMatchMazes", () => {
  it("drops a match's copies once it is past the window, and keeps its result", async () => {
    const author = await player();
    const mazeId = await savedMaze(author.caller, "Old");
    const { matchId, rival } = await playWith(author.caller, mazeId);
    await endAgo(rival, matchId, 31);

    await purgeAll();

    expect(await copiesIn(matchId)).toEqual([]);
    // The author's own labyrinth is theirs, whatever happens to the match.
    expect(await exists(mazeId)).toBe(true);
    const result = await author.caller.run.result({ matchId });
    expect(result.outcome).toBe("won");
    expect(result.mazes).toEqual({ theirs: null, yours: null });
  });

  it("keeps the copies of a match that ended inside the window", async () => {
    const author = await player();
    const mazeId = await savedMaze(author.caller, "Recent");
    const { matchId, rival } = await playWith(author.caller, mazeId);
    await endAgo(rival, matchId, 29);
    // Deleting the labyrinth changes nothing for the match.
    await author.caller.maze.remove({ id: mazeId });

    await purgeAll();

    expect(await copiesIn(matchId)).toHaveLength(2);
    const result = await author.caller.run.result({ matchId });
    expect(result.mazes?.yours).not.toBeNull();
  });

  it("keeps the copies of a match still being played", async () => {
    const author = await player();
    const mazeId = await savedMaze(author.caller, "Live");
    const { matchId } = await playWith(author.caller, mazeId);

    await purgeAll(new Date(Date.now() + 400 * DAY));

    expect(await copiesIn(matchId)).toHaveLength(2);
  });

  it("purges each match on its own clock, for one labyrinth used twice", async () => {
    const author = await player();
    const mazeId = await savedMaze(author.caller, "Reused");
    const first = await playWith(author.caller, mazeId);
    await endAgo(first.rival, first.matchId, 40);
    const second = await playWith(author.caller, mazeId, {
      ...solvableDraft(),
      treasure: { x: 0, y: 5 },
    });
    await endAgo(second.rival, second.matchId, 5);

    await purgeAll();

    expect(await copiesIn(first.matchId)).toEqual([]);
    expect(await copiesIn(second.matchId)).toHaveLength(2);
  });

  it("keeps both seats of a guest's match it purges", async () => {
    const member = await player();
    const guestCtx = await guestSignedIn();
    const guest = createCaller(guestCtx);
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

    expect(await copiesIn(created.id)).toEqual([]);
    const seats = await db
      .select({ userId: matchPlayer.userId })
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    expect(seats).toHaveLength(2);
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
