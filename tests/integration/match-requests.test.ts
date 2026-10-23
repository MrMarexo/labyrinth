import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EVENTS,
  HOURS_24_MS,
  lobbyChannel,
  matchChannel,
  userChannel,
} from "~/match";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { match, matchPlayer, matchRequest } from "~/server/db/schema";
import { swapPublisherForTests } from "~/server/realtime";

import { signedIn } from "./players";
import { rejection, sweepAll } from "./support";

const settings = { cellCount: 36 as const, gateCount: 0 };

async function player() {
  const ctx = await signedIn();
  return { caller: createCaller(ctx), id: ctx.session!.user.id };
}

async function lockedMatch() {
  const creator = await player();
  const created = await creator.caller.match.create({
    ...settings,
    access: "locked",
  });
  return { creator, matchId: created.id };
}

const requestsFor = (matchId: string) =>
  db.select().from(matchRequest).where(eq(matchRequest.matchId, matchId));

type Event = { channel: string; event: string; data: unknown };
let events: Event[] = [];
let restore: () => void = () => undefined;

beforeEach(() => {
  events = [];
  restore = swapPublisherForTests({
    async publish(channel, event, data) {
      events.push({ channel, event, data });
    },
  });
});
afterEach(() => restore());

const pinged = (channel: string) =>
  events.some((e) => e.channel === channel && e.event === EVENTS.changed);

describe("join requests", () => {
  it("accepting seats the requester and clears the match's requests", async () => {
    const { creator, matchId } = await lockedMatch();
    const a = await player();
    const b = await player();
    await a.caller.match.requestJoin({ matchId });
    await b.caller.match.requestJoin({ matchId });

    await creator.caller.match.acceptRequest({ matchId, userId: a.id });

    const [row] = await db.select().from(match).where(eq(match.id, matchId));
    expect(row?.status).toBe("drawing");
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, matchId));
    expect(players.map((p) => p.userId).sort()).toEqual(
      [creator.id, a.id].sort(),
    );
    expect(await requestsFor(matchId)).toEqual([]);
  });

  it("refuses a request after a decline", async () => {
    const { creator, matchId } = await lockedMatch();
    const a = await player();
    await a.caller.match.requestJoin({ matchId });
    await creator.caller.match.declineRequest({ matchId, userId: a.id });
    expect(await rejection(a.caller.match.requestJoin({ matchId }))).toEqual({
      code: "CONFLICT",
      message: "errors.requestDeclined",
    });
  });

  it("lets a requester withdraw and request again", async () => {
    const { matchId } = await lockedMatch();
    const a = await player();
    await a.caller.match.requestJoin({ matchId });
    await a.caller.match.withdrawRequest({ matchId });
    expect(await requestsFor(matchId)).toEqual([]);
    await a.caller.match.requestJoin({ matchId });
    expect(await requestsFor(matchId)).toHaveLength(1);
  });

  it("does not delete a declined row on withdraw", async () => {
    const { creator, matchId } = await lockedMatch();
    const a = await player();
    await a.caller.match.requestJoin({ matchId });
    await creator.caller.match.declineRequest({ matchId, userId: a.id });
    await a.caller.match.withdrawRequest({ matchId });
    expect(await requestsFor(matchId)).toHaveLength(1);
  });

  it("treats a second pending request as a no-op", async () => {
    const { matchId } = await lockedMatch();
    const a = await player();
    await a.caller.match.requestJoin({ matchId });
    await a.caller.match.requestJoin({ matchId });
    expect(await requestsFor(matchId)).toHaveLength(1);
  });

  it("refuses requests on open matches, by the creator and on expired ones", async () => {
    const creator = await player();
    const open = await creator.caller.match.create({
      ...settings,
      access: "open",
    });
    const a = await player();
    expect(
      await rejection(a.caller.match.requestJoin({ matchId: open.id })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchNotLocked" });

    const locked = await lockedMatch();
    expect(
      await rejection(
        locked.creator.caller.match.requestJoin({ matchId: locked.matchId }),
      ),
    ).toEqual({ code: "CONFLICT", message: "errors.alreadyInMatch" });

    await db
      .update(match)
      .set({ deadlineAt: new Date(Date.now() - 60_000) })
      .where(eq(match.id, locked.matchId));
    expect(
      await rejection(a.caller.match.requestJoin({ matchId: locked.matchId })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchExpired" });
    expect(
      await rejection(
        locked.creator.caller.match.acceptRequest({
          matchId: locked.matchId,
          userId: a.id,
        }),
      ),
    ).toEqual({ code: "CONFLICT", message: "errors.matchExpired" });
  });

  it("is NOT_FOUND to request a match that does not exist", async () => {
    const a = await player();
    expect(
      await rejection(a.caller.match.requestJoin({ matchId: "nope" })),
    ).toEqual({ code: "NOT_FOUND", message: "errors.matchNotFound" });
  });

  it("lists pending requests oldest first, for the creator only", async () => {
    const { creator, matchId } = await lockedMatch();
    const a = await player();
    const b = await player();
    const c = await player();
    await a.caller.match.requestJoin({ matchId });
    await b.caller.match.requestJoin({ matchId });
    await c.caller.match.requestJoin({ matchId });
    await creator.caller.match.declineRequest({ matchId, userId: c.id });

    const listed = await creator.caller.match.requests({ matchId });
    expect(listed.map((r) => r.userId)).toEqual([a.id, b.id]);
    expect(listed[0]).toMatchObject({ name: "Test Person" });
    expect(listed[0]!.createdAt).toBeInstanceOf(Date);
  });

  it("keeps requests, accept and decline to the creator", async () => {
    const { matchId } = await lockedMatch();
    const a = await player();
    await a.caller.match.requestJoin({ matchId });
    const forbidden = { code: "FORBIDDEN", message: "errors.notYourMatch" };
    expect(await rejection(a.caller.match.requests({ matchId }))).toEqual(
      forbidden,
    );
    expect(
      await rejection(a.caller.match.acceptRequest({ matchId, userId: a.id })),
    ).toEqual(forbidden);
    expect(
      await rejection(a.caller.match.declineRequest({ matchId, userId: a.id })),
    ).toEqual(forbidden);
  });

  it("refuses to accept a withdrawn or declined request", async () => {
    const { creator, matchId } = await lockedMatch();
    const a = await player();
    const b = await player();
    await a.caller.match.requestJoin({ matchId });
    await a.caller.match.withdrawRequest({ matchId });
    const gone = { code: "CONFLICT", message: "errors.requestGone" };
    expect(
      await rejection(
        creator.caller.match.acceptRequest({ matchId, userId: a.id }),
      ),
    ).toEqual(gone);

    await b.caller.match.requestJoin({ matchId });
    await creator.caller.match.declineRequest({ matchId, userId: b.id });
    expect(
      await rejection(
        creator.caller.match.acceptRequest({ matchId, userId: b.id }),
      ),
    ).toEqual(gone);
  });

  it("seats exactly one of two racing accepts", async () => {
    const { creator, matchId } = await lockedMatch();
    const a = await player();
    const b = await player();
    await a.caller.match.requestJoin({ matchId });
    await b.caller.match.requestJoin({ matchId });

    const results = await Promise.allSettled([
      creator.caller.match.acceptRequest({ matchId, userId: a.id }),
      creator.caller.match.acceptRequest({ matchId, userId: b.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, matchId));
    expect(players).toHaveLength(2);
  });

  it("removes pending requests when the match is cancelled", async () => {
    const { creator, matchId } = await lockedMatch();
    const a = await player();
    await a.caller.match.requestJoin({ matchId });
    events = [];
    await creator.caller.match.cancel({ matchId });
    expect(await requestsFor(matchId)).toEqual([]);
    expect(pinged(lobbyChannel())).toBe(true);
    expect(pinged(userChannel(a.id))).toBe(true);
    expect(pinged(matchChannel(matchId))).toBe(true);
  });

  describe("publishing", () => {
    it("requestJoin pings the match", async () => {
      const { matchId } = await lockedMatch();
      const a = await player();
      events = [];
      await a.caller.match.requestJoin({ matchId });
      expect(pinged(matchChannel(matchId))).toBe(true);
    });

    it("declineRequest pings the requester", async () => {
      const { creator, matchId } = await lockedMatch();
      const a = await player();
      await a.caller.match.requestJoin({ matchId });
      events = [];
      await creator.caller.match.declineRequest({ matchId, userId: a.id });
      expect(pinged(userChannel(a.id))).toBe(true);
    });

    it("acceptRequest pings every requester, the match and the lobby", async () => {
      const { creator, matchId } = await lockedMatch();
      const a = await player();
      const b = await player();
      await a.caller.match.requestJoin({ matchId });
      await b.caller.match.requestJoin({ matchId });
      events = [];
      await creator.caller.match.acceptRequest({ matchId, userId: a.id });
      expect(pinged(userChannel(a.id))).toBe(true);
      expect(pinged(userChannel(b.id))).toBe(true);
      expect(pinged(matchChannel(matchId))).toBe(true);
      expect(pinged(lobbyChannel())).toBe(true);
    });
  });
});

describe("expired matches", () => {
  it("create pings the old match it abandons", async () => {
    const creator = await player();
    const old = await creator.caller.match.create(settings);
    await db
      .update(match)
      .set({
        createdAt: new Date(Date.now() - HOURS_24_MS - 2000),
        deadlineAt: new Date(Date.now() - 1000),
      })
      .where(eq(match.id, old.id));
    events = [];
    await creator.caller.match.create(settings);
    expect(pinged(matchChannel(old.id))).toBe(true);
  });

  it("the sweep pings the lobby and each requester of an abandoned match", async () => {
    const { matchId } = await lockedMatch();
    const a = await player();
    await a.caller.match.requestJoin({ matchId });
    events = [];
    await sweepAll(db, new Date(Date.now() + HOURS_24_MS + 1000));
    expect(pinged(lobbyChannel())).toBe(true);
    expect(pinged(userChannel(a.id))).toBe(true);
    expect(pinged(matchChannel(matchId))).toBe(true);
  });
});
