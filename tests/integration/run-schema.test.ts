import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match, matchPlayer, move } from "~/server/db/schema";

async function signedIn() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

async function seatedMatch() {
  const ctx = await signedIn();
  const created = await createCaller(ctx).match.create({
    cellCount: 36,
    gateCount: 0,
  });
  return { matchId: created.id, userId: ctx.session!.user.id };
}

const delta = {
  outcome: "moved" as const,
  from: { x: 0, y: 0 },
  at: { x: 1, y: 0 },
  penalties: 0,
  moves: 1,
  finished: false,
};

describe("the move table", () => {
  it("refuses a second move with the same seq for the same runner", async () => {
    const { matchId, userId } = await seatedMatch();
    const row = {
      matchId,
      runnerId: userId,
      seq: 1,
      dir: "E" as const,
      outcome: "moved" as const,
      delta,
    };
    await db.insert(move).values(row);
    await expect(db.insert(move).values(row)).rejects.toThrow(
      /move_runner_seq_unique/,
    );
  });

  it("goes with its match", async () => {
    const { matchId, userId } = await seatedMatch();
    await db.insert(move).values({
      matchId,
      runnerId: userId,
      seq: 1,
      dir: "E",
      outcome: "moved",
      delta,
    });
    await db.delete(match).where(eq(match.id, matchId));
    const left = await db.select().from(move).where(eq(move.matchId, matchId));
    expect(left).toEqual([]);
  });
});

describe("match_player run columns", () => {
  it("refuses a run that both finished and gave up", async () => {
    const { matchId } = await seatedMatch();
    const now = new Date();
    await expect(
      db
        .update(matchPlayer)
        .set({ finishedAt: now, gaveUpAt: now })
        .where(eq(matchPlayer.matchId, matchId)),
    ).rejects.toThrow(/match_player_finished_or_gave_up/);
  });
});
