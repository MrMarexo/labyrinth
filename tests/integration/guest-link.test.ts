import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { linkGuest } from "~/server/guest/link";
import {
  match,
  matchPlayer,
  matchRequest,
  maze,
  user,
} from "~/server/db/schema";
import { purgeDeletedMazes } from "~/server/maze/purge";

import {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  GATED_MAZE_ROUTE,
  gatedMazeDraft,
} from "../fixtures/maze";
import { guestSignedIn, signedIn } from "./players";
import { sweepAll } from "./support";

const settings = {
  cellCount: GATED_MAZE_CELL_COUNT,
  gateCount: GATED_MAZE_GATE_COUNT,
} as const;

const PASSWORD = "correct-horse-battery";
const DAY_MS = 24 * 60 * 60 * 1000;

type Caller = ReturnType<typeof createCaller>;

async function contextFrom(response: Response) {
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

async function signUpFrom(guestCookie: string) {
  const response = await auth.api.signUpEmail({
    body: {
      email: `test-${crypto.randomUUID()}@example.test`,
      password: PASSWORD,
      name: "Linked Person",
    },
    headers: new Headers({ cookie: guestCookie }),
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return contextFrom(response);
}

async function signInFrom(guestCookie: string, email: string) {
  const response = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    headers: new Headers({ cookie: guestCookie }),
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return contextFrom(response);
}

async function userExists(id: string) {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, id));
  return rows.length === 1;
}

async function submitGated(caller: Caller, matchId: string) {
  const concept = await caller.maze.conceptForMatch({
    matchId,
    name: "Gated",
    replace: true,
  });
  await caller.maze.saveDraft({
    id: concept.id,
    data: gatedMazeDraft(),
    expectedVersion: 0,
  });
  await caller.match.submitMaze({ matchId, mazeId: concept.id });
  return concept.id;
}

async function guestInMembersMatch() {
  const memberCtx = await signedIn();
  const guestCtx = await guestSignedIn();
  const member = createCaller(memberCtx);
  const guest = createCaller(guestCtx);
  const created = await member.match.create(settings);
  await guest.match.join({ matchId: created.id });
  return {
    member,
    memberCtx,
    guest,
    guestCtx,
    guestId: guestCtx.session!.user.id,
    matchId: created.id,
  };
}

describe("linking a guest to an account", () => {
  it("sign-up moves a running match", async () => {
    const { member, guest, guestCtx, guestId, matchId } =
      await guestInMembersMatch();
    await submitGated(member, matchId);
    await submitGated(guest, matchId);
    const half = 3;
    for (const [i, dir] of GATED_MAZE_ROUTE.slice(0, half).entries()) {
      await guest.run.move({ matchId, seq: i + 1, dir });
    }
    const before = await guest.run.get({ matchId });

    const accountCtx = await signUpFrom(guestCtx.cookie);
    const account = createCaller(accountCtx);

    expect(await account.viewer.get()).toEqual({ kind: "member" });
    expect(await userExists(guestId)).toBe(false);
    expect(await account.run.get({ matchId })).toEqual(before);
    await account.run.move({
      matchId,
      seq: half + 1,
      dir: GATED_MAZE_ROUTE[half]!,
    });
  });

  it("sign-up keeps a submitted maze", async () => {
    const { member, guest, guestCtx, matchId } = await guestInMembersMatch();
    await submitGated(member, matchId);
    const mazeId = await submitGated(guest, matchId);

    const accountCtx = await signUpFrom(guestCtx.cookie);
    const accountId = accountCtx.session!.user.id;
    const account = createCaller(accountCtx);

    const [row] = await db.select().from(maze).where(eq(maze.id, mazeId));
    expect(row?.authorId).toBe(accountId);
    expect(row?.deletedAt).toBeNull();
    const listed = (await account.maze.list()).find((m) => m.id === mazeId);
    expect(listed?.state).toBe("used");

    await sweepAll(db, new Date(Date.now() + 30 * DAY_MS));
    const [ended] = await db
      .select({ endedAt: match.endedAt })
      .from(match)
      .where(eq(match.id, matchId));
    expect(ended?.endedAt).not.toBeNull();
    await purgeDeletedMazes(
      db,
      new Date(ended!.endedAt!.getTime() + 31 * DAY_MS),
    );
    const [kept] = await db.select().from(maze).where(eq(maze.id, mazeId));
    expect(kept?.deletedAt).toBeNull();
  });

  it("sign-up moves a pending request", async () => {
    const member = createCaller(await signedIn());
    const guestCtx = await guestSignedIn();
    const guestId = guestCtx.session!.user.id;
    const created = await member.match.create({
      ...settings,
      access: "locked",
    });
    await createCaller(guestCtx).match.requestJoin({ matchId: created.id });

    const accountCtx = await signUpFrom(guestCtx.cookie);
    const accountId = accountCtx.session!.user.id;

    const rows = await db
      .select({ userId: matchRequest.userId })
      .from(matchRequest)
      .where(eq(matchRequest.matchId, created.id));
    expect(rows).toEqual([{ userId: accountId }]);
    expect(await userExists(guestId)).toBe(false);
    const listed = await member.match.requests({ matchId: created.id });
    expect(listed[0]?.guest).toBe(false);
    expect(listed[0]?.name).toBe("Linked Person");
  });

  it("sign-in to an account already in the same match keeps the guest", async () => {
    const { memberCtx, guestCtx, guestId, matchId } =
      await guestInMembersMatch();
    const memberId = memberCtx.session!.user.id;
    const seatsBefore = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, matchId));
    const [matchBefore] = await db
      .select()
      .from(match)
      .where(eq(match.id, matchId));

    const accountCtx = await signInFrom(
      guestCtx.cookie,
      memberCtx.session!.user.email,
    );
    expect(accountCtx.session!.user.id).toBe(memberId);

    expect(await userExists(guestId)).toBe(true);
    const seatsAfter = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, matchId));
    expect(seatsAfter).toEqual(expect.arrayContaining(seatsBefore));
    expect(seatsAfter).toHaveLength(seatsBefore.length);
    const [matchAfter] = await db
      .select()
      .from(match)
      .where(eq(match.id, matchId));
    expect(matchAfter).toEqual(matchBefore);
  });

  it("concept collision while drawing", async () => {
    const accountCtx = await signedIn();
    const accountId = accountCtx.session!.user.id;
    const ownConcept = await createCaller(accountCtx).maze.createConcept({
      name: "Mine",
      ...settings,
      replace: true,
    });

    const { guest, guestCtx, matchId } = await guestInMembersMatch();
    const guestConcept = await guest.maze.conceptForMatch({
      matchId,
      name: "Gated",
      replace: true,
    });

    await signInFrom(guestCtx.cookie, accountCtx.session!.user.email);

    const rows = await db
      .select({ id: maze.id, concept: maze.concept })
      .from(maze)
      .where(eq(maze.authorId, accountId));
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: ownConcept.id, concept: false },
        { id: guestConcept.id, concept: true },
      ]),
    );
    const [seat] = await db
      .select({ userId: matchPlayer.userId })
      .from(matchPlayer)
      .where(
        and(
          eq(matchPlayer.matchId, matchId),
          eq(matchPlayer.userId, accountId),
        ),
      );
    expect(seat).toBeDefined();
  });

  it("names the matches whose seats and requests moved", async () => {
    const accountId = (await signedIn()).session!.user.id;
    const guestCtx = await guestSignedIn();
    const guestId = guestCtx.session!.user.id;
    const guest = createCaller(guestCtx);
    const locked = await createCaller(await signedIn()).match.create({
      ...settings,
      access: "locked",
    });
    await guest.match.requestJoin({ matchId: locked.id });
    const open = await createCaller(await signedIn()).match.create(settings);
    await guest.match.join({ matchId: open.id });
    const matchId = open.id;

    const { keepGuest, changedMatchIds } = await linkGuest(db, {
      guestId,
      accountId,
    });

    expect(keepGuest).toBe(false);
    expect(changedMatchIds).toHaveLength(2);
    expect(changedMatchIds).toEqual(
      expect.arrayContaining([matchId, locked.id]),
    );
  });

  it("a wrong password links nothing", async () => {
    const accountCtx = await signedIn();
    const { guestCtx, guestId, matchId } = await guestInMembersMatch();

    await expect(
      auth.api.signInEmail({
        body: {
          email: accountCtx.session!.user.email,
          password: "not-the-password",
        },
        headers: new Headers({ cookie: guestCtx.cookie }),
      }),
    ).rejects.toThrow();

    expect(await userExists(guestId)).toBe(true);
    const seats = await db
      .select({ userId: matchPlayer.userId })
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, matchId));
    expect(seats.map((s) => s.userId)).toContain(guestId);
  });
});
