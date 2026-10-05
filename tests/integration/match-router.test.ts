import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { CODE_LENGTH, HOURS_24_MS, HOURS_48_MS } from "~/match";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";

import { rejection } from "./support";

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

describe("match.create", () => {
  it("issues a code and seats the creator", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);

    const created = await caller.match.create(settings);

    expect(created.code).toHaveLength(CODE_LENGTH);
    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("awaiting_opponent");
    expect(row?.createdById).toBe(ctx.session!.user.id);
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    expect(players).toHaveLength(1);
    expect(players[0]?.userId).toBe(ctx.session!.user.id);
    expect(players[0]?.mazeId).toBeNull();
  });

  it("sets the row-1 deadline 24h out from creation", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.match.create(settings);

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    const gap = row!.deadlineAt.getTime() - row!.createdAt.getTime();
    // Both stamps come from the same insert, so the gap is exact rather
    // than approximate.
    expect(gap).toBe(HOURS_24_MS);
  });

  it("issues a different code to each match", async () => {
    const caller = createCaller(await signedIn());
    const a = await caller.match.create(settings);
    const b = await caller.match.create(settings);
    expect(a.code).not.toBe(b.code);
  });

  it("rejects a cell count that is not a preset", async () => {
    const caller = createCaller(await signedIn());
    expect(
      await rejection(caller.match.create({ cellCount: 37, gateCount: 0 })),
    ).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an anonymous caller with a message key", async () => {
    const caller = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    expect(await rejection(caller.match.create(settings))).toEqual({
      code: "UNAUTHORIZED",
      message: "errors.notSignedIn",
    });
  });
});

describe("match.join", () => {
  it("seats the second player and moves the match to drawing", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guestCtx = await signedIn();
    const guest = createCaller(guestCtx);

    const joined = await guest.match.join({ code: created.code });

    expect(joined.id).toBe(created.id);
    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("drawing");
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    expect(players).toHaveLength(2);
    expect(players.map((p) => p.userId)).toContain(guestCtx.session!.user.id);
  });

  it("moves the deadline to row 2's 48h once both have joined", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());

    await guest.match.join({ code: created.code });

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    const gap = row!.deadlineAt.getTime() - row!.lastActivityAt.getTime();
    expect(gap).toBe(HOURS_48_MS);
  });

  it("accepts a lowercase code", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());

    const joined = await guest.match.join({
      code: created.code.toLowerCase(),
    });
    expect(joined.id).toBe(created.id);
  });

  it("refuses a third player", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });

    const third = createCaller(await signedIn());
    expect(await rejection(third.match.join({ code: created.code }))).toEqual({
      code: "CONFLICT",
      message: "errors.matchFull",
    });
  });

  it("refuses the host joining their own match", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);

    expect(await rejection(host.match.join({ code: created.code }))).toEqual({
      code: "CONFLICT",
      message: "errors.alreadyInMatch",
    });
  });

  it("refuses an unknown code", async () => {
    const guest = createCaller(await signedIn());
    expect(await rejection(guest.match.join({ code: "ZZZZZZ" }))).toEqual({
      code: "NOT_FOUND",
      message: "errors.matchCodeUnknown",
    });
  });

  it("refuses a malformed code with a message key", async () => {
    const guest = createCaller(await signedIn());
    expect(await rejection(guest.match.join({ code: "nope" }))).toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("refuses a match whose deadline has already passed", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await db
      .update(match)
      .set({ deadlineAt: new Date(Date.now() - 1000) })
      .where(eq(match.id, created.id));

    const guest = createCaller(await signedIn());
    expect(await rejection(guest.match.join({ code: created.code }))).toEqual({
      code: "CONFLICT",
      message: "errors.matchExpired",
    });
  });
});

describe("match.get", () => {
  it("shows a participant the match and both players", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });

    const view = await host.match.get({ id: created.id });

    expect(view.status).toBe("drawing");
    expect(view.cellCount).toBe(36);
    expect(view.you.hasSubmitted).toBe(false);
    expect(view.opponent?.hasSubmitted).toBe(false);
    expect(view.opponent?.displayName).toBe("Test Person");
  });

  it("never returns the opponent's maze id", async () => {
    // The maze a player solves is the opponent's match_player.mazeId. That
    // join is the only place the mapping exists, and it does not belong on
    // the wire — Phase 4 serves moves, not mazes.
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ code: created.code });

    const view = await host.match.get({ id: created.id });

    expect(JSON.stringify(view)).not.toContain("mazeId");
    expect(Object.keys(view.opponent ?? {})).toEqual([
      "displayName",
      "hasSubmitted",
      "hasForfeited",
    ]);
  });

  it("refuses a stranger, indistinguishably from a match that does not exist", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const stranger = createCaller(await signedIn());

    const notMine = await rejection(stranger.match.get({ id: created.id }));
    const missing = await rejection(
      stranger.match.get({ id: crypto.randomUUID() }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
    expect(missing).toEqual(notMine);
  });
});

describe("match.list", () => {
  it("returns only the caller's matches, newest first", async () => {
    const mineCtx = await signedIn();
    const mine = createCaller(mineCtx);
    const first = await mine.match.create(settings);
    const second = await mine.match.create(settings);
    await createCaller(await signedIn()).match.create(settings);

    const listed = await mine.match.list();

    const ids = listed.map((m) => m.id);
    expect(ids).toEqual([second.id, first.id]);
  });

  it("includes a match the caller joined rather than created", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());
    await guest.match.join({ code: created.code });

    const listed = await guest.match.list();
    expect(listed.map((m) => m.id)).toContain(created.id);
  });
});
