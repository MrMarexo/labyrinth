import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";

import { runningMatch } from "./players";
import { rejection } from "./support";

const DAY = 24 * 60 * 60 * 1000;

/** A match the guest gave up, so it is over, aged `days` since it ended. */
async function endedMatch(days: number) {
  const players = await runningMatch();
  await players.guest.run.giveUp({ matchId: players.matchId });
  await db
    .update(match)
    .set({ endedAt: new Date(Date.now() - days * DAY) })
    .where(eq(match.id, players.matchId));
  return players;
}

async function mazeOf(matchId: string, userId: string) {
  const [row] = await db
    .select({ mazeId: matchPlayer.mazeId })
    .from(matchPlayer)
    .where(
      and(eq(matchPlayer.matchId, matchId), eq(matchPlayer.userId, userId)),
    );
  return row!.mazeId!;
}

const expired = { code: "CONFLICT", message: "errors.replayExpired" };

describe("replay retention", () => {
  it("replays a match that ended 29 days ago", async () => {
    const { host, matchId } = await endedMatch(29);
    await expect(
      host.run.replay({ matchId, whose: "mine" }),
    ).resolves.toHaveProperty("maze");
    expect((await host.run.result({ matchId })).replayable).toBe(true);
  });

  it("refuses both replays 31 days after the end", async () => {
    const { host, matchId } = await endedMatch(31);
    expect(
      await rejection(host.run.replay({ matchId, whose: "mine" })),
    ).toEqual(expired);
    expect(
      await rejection(host.run.replay({ matchId, whose: "opponent" })),
    ).toEqual(expired);
  });

  it("keeps the result and both drawings when nothing was deleted", async () => {
    const { host, matchId } = await endedMatch(31);
    const result = await host.run.result({ matchId });
    expect(result.replayable).toBe(false);
    expect(result.outcome).toBe("won");
    expect(result.mazes?.theirs).not.toBeNull();
    expect(result.mazes?.yours).not.toBeNull();
  });

  it("drops only the deleted drawing once the window closes, from either side", async () => {
    const { host, guest, hostId, matchId } = await endedMatch(31);
    await host.maze.remove({ id: await mazeOf(matchId, hostId) });

    const forHost = await host.run.result({ matchId });
    expect(forHost.mazes?.yours).toBeNull();
    expect(forHost.mazes?.theirs).not.toBeNull();

    const forGuest = await guest.run.result({ matchId });
    expect(forGuest.mazes?.theirs).toBeNull();
    expect(forGuest.mazes?.yours).not.toBeNull();
  });

  it("still draws a deleted labyrinth inside the window", async () => {
    const { host, hostId, matchId } = await endedMatch(5);
    await host.maze.remove({ id: await mazeOf(matchId, hostId) });

    const result = await host.run.result({ matchId });
    expect(result.replayable).toBe(true);
    expect(result.mazes?.yours).not.toBeNull();
    expect(result.mazes?.theirs).not.toBeNull();
  });
});
