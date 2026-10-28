import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "~/server/db";
import { match } from "~/server/db/schema";

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

  it("keeps the result but drops both drawings once the window closes", async () => {
    const { host, matchId } = await endedMatch(31);
    const result = await host.run.result({ matchId });
    expect(result.replayable).toBe(false);
    expect(result.outcome).toBe("won");
    expect(result.mazes).toEqual({ theirs: null, yours: null });
  });

  it("still draws a deleted labyrinth inside the window", async () => {
    const { host, hostMazeId, matchId } = await endedMatch(5);
    await host.maze.remove({ id: hostMazeId });

    const result = await host.run.result({ matchId });
    expect(result.replayable).toBe(true);
    expect(result.mazes?.yours).not.toBeNull();
    expect(result.mazes?.theirs).not.toBeNull();
  });
});
