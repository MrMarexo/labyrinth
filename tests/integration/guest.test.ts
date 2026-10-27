import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { db } from "~/server/db";

import {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
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
      () =>
        guest.maze.editAsConcept({ id: "x", copyName: "Copy", replace: true }),
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
