import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { db } from "~/server/db";
import { matchMaze, maze } from "~/server/db/schema";

import {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  GATED_MAZE_ROUTE,
  gatedMazeDraft,
} from "../fixtures/maze";
import { guestSignedIn, signedIn } from "./players";
import { rejection, sweepAll } from "./support";

const settings = {
  cellCount: GATED_MAZE_CELL_COUNT,
  gateCount: GATED_MAZE_GATE_COUNT,
} as const;

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;

async function guestInMembersMatch() {
  const member = createCaller(await signedIn());
  const guest = createCaller(await guestSignedIn());
  const created = await member.match.create(settings);
  await guest.match.join({ matchId: created.id });
  return { member, guest, matchId: created.id };
}

describe("guest identity", () => {
  it("guest sign-in makes an anonymous user with a four-digit name", async () => {
    const ctx = await guestSignedIn();

    expect(ctx.session?.user.isAnonymous).toBe(true);
    expect(ctx.session?.user.name).toMatch(/^[1-9]\d{3}$/);
  });

  it("viewer.get tells a visitor, a guest and a member apart", async () => {
    const visitor = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    expect(await visitor.viewer.get()).toEqual({ kind: "visitor" });

    const guestCtx = await guestSignedIn();
    expect(await createCaller(guestCtx).viewer.get()).toEqual({
      kind: "guest",
      number: guestCtx.session!.user.name,
    });

    expect(await createCaller(await signedIn()).viewer.get()).toEqual({
      kind: "member",
    });
  });

  it("guest is refused everything outside their own match", async () => {
    const guest = createCaller(await guestSignedIn());
    const forbidden = { code: "FORBIDDEN", message: "errors.guestNotAllowed" };
    const concept = { name: "Mine", ...settings, replace: true };

    for (const call of [
      () => guest.match.create(settings),
      () => guest.maze.list(),
      () => guest.maze.createConcept(concept),
      () => guest.maze.editAsConcept({ id: "x", replace: true }),
      () => guest.maze.saveConcept({ id: "x", expectedVersion: 0 }),
      () => guest.maze.remove({ id: "x" }),
      () => guest.profile.get(),
      () => guest.profile.setName({ name: "Nope" }),
      () => guest.profile.setLocale({ locale: "sk" }),
    ]) {
      expect(await rejection(call())).toEqual(forbidden);
    }
  });

  it("guest can still play in a match they joined", async () => {
    const { guest, matchId } = await guestInMembersMatch();

    const concept = await guest.maze.conceptForMatch({
      matchId,
      name: "Gated",
      replace: true,
    });
    await guest.maze.get({ id: concept.id });
    await guest.maze.saveDraft({
      id: concept.id,
      data: gatedMazeDraft(),
      expectedVersion: 0,
    });
    await guest.match.eligibleMazes({ matchId });
    await guest.match.submitMaze({ matchId, mazeId: concept.id });
  });

  it("match.list hides a guest's finished matches but not a member's", async () => {
    const { member, guest, matchId } = await guestInMembersMatch();
    expect((await guest.match.list()).map((m) => m.id)).toContain(matchId);

    await sweepAll(db, new Date(Date.now() + DAYS_30_MS));

    expect(await guest.match.list()).toEqual([]);
    expect((await member.match.list()).map((m) => m.id)).toContain(matchId);
  });
});

describe("guest names", () => {
  it("a member sees a joined guest as a guest with their number", async () => {
    const { member, matchId } = await guestInMembersMatch();
    const view = await member.match.get({ id: matchId });
    expect(view.opponent?.guest).toBe(true);
    expect(view.opponent?.displayName).toMatch(/^[1-9]\d{3}$/);
  });

  it("a member sees a requesting guest as a guest in match.requests", async () => {
    const member = createCaller(await signedIn());
    const guest = createCaller(await guestSignedIn());
    const created = await member.match.create({
      ...settings,
      access: "locked",
    });
    await guest.match.requestJoin({ matchId: created.id });

    const rows = await member.match.requests({ matchId: created.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.guest).toBe(true);
    expect(rows[0]?.name).toMatch(/^[1-9]\d{3}$/);
  });

  it("the lobby reports a member creator as not a guest", async () => {
    const created = await createCaller(await signedIn()).match.create(settings);
    const viewer = createCaller(await signedIn());

    const { matches } = await viewer.match.lobby();
    expect(matches.find((m) => m.id === created.id)?.creatorGuest).toBe(false);
  });

  it("a member opponent is not marked as a guest", async () => {
    const a = createCaller(await signedIn());
    const b = createCaller(await signedIn());
    const created = await a.match.create(settings);
    await b.match.join({ matchId: created.id });

    expect((await a.match.get({ id: created.id })).opponent?.guest).toBe(false);
  });
});

describe("what a guest leaves behind", () => {
  it("a guest's match plays its own copies, the guest's labyrinth deleted or not", async () => {
    const member = createCaller(await signedIn());
    const guestCtx = await guestSignedIn();
    const guest = createCaller(guestCtx);
    const created = await member.match.create(settings);
    await guest.match.join({ matchId: created.id });

    const submit = async (caller: typeof member) => {
      const concept = await caller.maze.conceptForMatch({
        matchId: created.id,
        name: "Gated",
        replace: true,
      });
      await caller.maze.saveDraft({
        id: concept.id,
        data: gatedMazeDraft(),
        expectedVersion: 0,
      });
      await caller.match.submitMaze({
        matchId: created.id,
        mazeId: concept.id,
      });
    };
    await submit(member);
    await submit(guest);

    const copies = await db
      .select({ userId: matchMaze.userId })
      .from(matchMaze)
      .where(eq(matchMaze.matchId, created.id));
    expect(copies).toHaveLength(2);
    // A guest has no library to manage; their labyrinths go with the guest.
    await db.delete(maze).where(eq(maze.authorId, guestCtx.session!.user.id));

    for (const caller of [member, guest]) {
      for (const [i, dir] of GATED_MAZE_ROUTE.entries()) {
        await caller.run.move({
          matchId: created.id,
          seq: i + 1,
          dir: dir,
        });
      }
    }
    const result = await member.run.result({ matchId: created.id });
    expect(result.mazes?.theirs).not.toBeNull();
  });
});
