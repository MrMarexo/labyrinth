import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match, matchRequest } from "~/server/db/schema";

async function signedIn() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

const settings = { cellCount: 36 as const, gateCount: 0 };

describe("match_winner_requires_win", () => {
  it("rejects a direct update that gives an abandoned match a winner", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    const created = await caller.match.create(settings);

    // No router procedure writes `winnerId` this way in Phase 3 — this
    // reaches past the application entirely to prove the database itself
    // refuses the row, not merely that the one writer we have is careful.
    await expect(
      db
        .update(match)
        .set({ winnerId: ctx.session!.user.id, endReason: "abandoned" })
        .where(eq(match.id, created.id)),
    ).rejects.toThrow(/match_winner_requires_win/);
  });

  it("still allows a winner on a match that actually finished", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    const created = await caller.match.create(settings);

    await expect(
      db
        .update(match)
        .set({ winnerId: ctx.session!.user.id, endReason: "finished" })
        .where(eq(match.id, created.id)),
    ).resolves.toBeDefined();

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.winnerId).toBe(ctx.session!.user.id);
  });
});

function waitingRow(
  createdById: string,
  status: "awaiting_opponent" | "drawing" = "awaiting_opponent",
) {
  return {
    code: crypto.randomUUID().slice(0, 8),
    cellCount: 36,
    gateCount: 0,
    status,
    createdById,
    deadlineAt: new Date(Date.now() + 60_000),
  };
}

describe("match_one_waiting_per_creator", () => {
  it("rejects a second awaiting_opponent match for one creator", async () => {
    const ctx = await signedIn();
    const userId = ctx.session!.user.id;
    await db.insert(match).values(waitingRow(userId));

    await expect(db.insert(match).values(waitingRow(userId))).rejects.toThrow(
      /match_one_waiting_per_creator/,
    );
  });

  it("accepts further matches that are no longer waiting", async () => {
    const ctx = await signedIn();
    const userId = ctx.session!.user.id;
    await db.insert(match).values(waitingRow(userId));

    await expect(
      db.insert(match).values(waitingRow(userId, "drawing")),
    ).resolves.toBeDefined();
  });

  it("defaults access to open", async () => {
    const ctx = await signedIn();
    const [row] = await db
      .insert(match)
      .values(waitingRow(ctx.session!.user.id))
      .returning();
    expect(row?.access).toBe("open");
  });
});

describe("match_request", () => {
  it("is deleted with its match", async () => {
    const host = await signedIn();
    const guest = await signedIn();
    const [row] = await db
      .insert(match)
      .values(waitingRow(host.session!.user.id))
      .returning();
    await db
      .insert(matchRequest)
      .values({ matchId: row!.id, userId: guest.session!.user.id });

    await db.delete(match).where(eq(match.id, row!.id));

    const left = await db
      .select()
      .from(matchRequest)
      .where(eq(matchRequest.matchId, row!.id));
    expect(left).toHaveLength(0);
  });

  it("rejects a duplicate request from one user", async () => {
    const host = await signedIn();
    const guest = await signedIn();
    const [row] = await db
      .insert(match)
      .values(waitingRow(host.session!.user.id))
      .returning();
    const values = { matchId: row!.id, userId: guest.session!.user.id };
    await db.insert(matchRequest).values(values);

    await expect(db.insert(matchRequest).values(values)).rejects.toThrow(
      /match_request_pkey|duplicate key/,
    );
  });
});
