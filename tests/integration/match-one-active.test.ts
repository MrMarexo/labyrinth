import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { makeCode } from "~/match";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { match, matchPlayer } from "~/server/db/schema";

import { signedIn } from "./players";
import { rejection } from "./support";

const settings = { cellCount: 36 as const, gateCount: 0 };

async function player() {
  const ctx = await signedIn();
  return { caller: createCaller(ctx), id: ctx.session!.user.id };
}

/** A match both players are drawing in. */
async function drawingMatch() {
  const host = await player();
  const guest = await player();
  const { id } = await host.caller.match.create(settings);
  await guest.caller.match.join({ matchId: id });
  return { host, guest, matchId: id };
}

const alreadyActive = { code: "CONFLICT", message: "errors.alreadyActive" };

describe("one active match at a time", () => {
  it("refuses to create a match while drawing in another", async () => {
    const { host, guest } = await drawingMatch();
    expect(await rejection(host.caller.match.create(settings))).toEqual(
      alreadyActive,
    );
    expect(await rejection(guest.caller.match.create(settings))).toEqual(
      alreadyActive,
    );
  });

  it("refuses to join while one's own match waits for an opponent", async () => {
    const me = await player();
    await me.caller.match.create(settings);
    const other = await (await player()).caller.match.create(settings);

    expect(
      await rejection(me.caller.match.join({ matchId: other.id })),
    ).toEqual(alreadyActive);
  });

  it("refuses to join while drawing in another", async () => {
    const { guest } = await drawingMatch();
    const other = await (await player()).caller.match.create(settings);

    expect(
      await rejection(guest.caller.match.join({ matchId: other.id })),
    ).toEqual(alreadyActive);
  });

  it("refuses to ask to join while in another", async () => {
    const { guest } = await drawingMatch();
    const other = await (
      await player()
    ).caller.match.create({
      ...settings,
      access: "locked",
    });

    expect(
      await rejection(guest.caller.match.requestJoin({ matchId: other.id })),
    ).toEqual(alreadyActive);
  });

  it("refuses to accept a requester who has since joined another", async () => {
    const creator = await player();
    const locked = await creator.caller.match.create({
      ...settings,
      access: "locked",
    });
    const requester = await player();
    await requester.caller.match.requestJoin({ matchId: locked.id });
    const open = await (await player()).caller.match.create(settings);
    await requester.caller.match.join({ matchId: open.id });

    expect(
      await rejection(
        creator.caller.match.acceptRequest({
          matchId: locked.id,
          userId: requester.id,
        }),
      ),
    ).toEqual({ code: "CONFLICT", message: "errors.requesterActive" });
  });

  it("lets a player whose run is over start another", async () => {
    const { host, matchId } = await drawingMatch();
    // Running, the host's run finished, the guest's still going.
    await db
      .update(match)
      .set({ status: "running" })
      .where(eq(match.id, matchId));
    await db
      .update(matchPlayer)
      .set({ finishedAt: new Date() })
      .where(
        and(eq(matchPlayer.matchId, matchId), eq(matchPlayer.userId, host.id)),
      );

    const next = await host.caller.match.create(settings);
    expect(next.id).not.toBe(matchId);
  });

  it("lists the match that holds the caller first, marked active", async () => {
    const { host, matchId } = await drawingMatch();
    // An older match that is over, created later so newest-first alone
    // would put it on top.
    const [ended] = await db
      .insert(match)
      .values({
        code: makeCode((max) => Math.floor(Math.random() * max)),
        cellCount: 36,
        gateCount: 0,
        status: "abandoned",
        endReason: "abandoned",
        createdById: host.id,
        createdAt: new Date(Date.now() + 60_000),
        lastActivityAt: new Date(),
        deadlineAt: new Date(),
        endedAt: new Date(),
      })
      .returning({ id: match.id });
    await db
      .insert(matchPlayer)
      .values({ matchId: ended!.id, userId: host.id });

    const list = await host.caller.match.list();
    expect(list.map((m) => [m.id, m.active])).toEqual([
      [matchId, true],
      [ended!.id, false],
    ]);
  });
});
