import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { HOURS_24_MS } from "~/match";
import { db } from "~/server/db";
import { match } from "~/server/db/schema";
import { closeIfExpired } from "~/server/match/sweep";

import { GATED_MAZE_ROUTE } from "../fixtures/maze";
import { runningMatch } from "./players";

type Caller = Awaited<ReturnType<typeof runningMatch>>["host"];

async function walk(caller: Caller, matchId: string, dirs: readonly string[]) {
  for (const [i, dir] of dirs.entries()) {
    await caller.run.move({
      matchId,
      seq: i + 1,
      dir: dir as "N" | "E" | "S" | "W",
    });
  }
}

async function rowOf(matchId: string) {
  const [row] = await db.select().from(match).where(eq(match.id, matchId));
  return row!;
}

describe("match.endedAt", () => {
  it("is null while a match is open", async () => {
    const { matchId } = await runningMatch();
    expect((await rowOf(matchId)).endedAt).toBeNull();
  });

  it("records when a match ended, on give-up", async () => {
    const { guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });
    const row = await rowOf(matchId);
    expect(row.endedAt).toBeInstanceOf(Date);
    expect(row.endedAt).toEqual(row.lastActivityAt);
  });

  it("records when a match ended, when both runs finish", async () => {
    const { host, guest, matchId } = await runningMatch();
    await walk(host, matchId, GATED_MAZE_ROUTE);
    await walk(guest, matchId, GATED_MAZE_ROUTE);
    const row = await rowOf(matchId);
    expect(row.status).toBe("complete");
    expect(row.endedAt).toEqual(row.lastActivityAt);
  });

  it("records when a match ended, when the sweep closes it", async () => {
    const { matchId } = await runningMatch();
    const at = new Date(Date.now() + HOURS_24_MS + 1000);
    expect(await closeIfExpired(db, matchId, at)).toBe(true);
    const row = await rowOf(matchId);
    expect(row.status).toBe("abandoned");
    expect(row.endedAt).toEqual(at);
  });
});
