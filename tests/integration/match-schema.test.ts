import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match } from "~/server/db/schema";

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
