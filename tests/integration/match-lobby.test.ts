import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match, matchRequest } from "~/server/db/schema";

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

describe("match.lobby", () => {
  it("lists others' fresh open and locked matches, newest first", async () => {
    const a = createCaller(await signedIn());
    const b = createCaller(await signedIn());
    const viewerCtx = await signedIn();
    const viewer = createCaller(viewerCtx);

    const open = await a.match.create({ ...settings, access: "open" });
    const locked = await b.match.create({ ...settings, access: "locked" });

    const lobby = await viewer.match.lobby();
    expect(lobby.you).toBe(viewerCtx.session!.user.id);
    const ids = lobby.matches.map((m) => m.id);
    expect(ids).toContain(open.id);
    expect(ids).toContain(locked.id);
    expect(ids.indexOf(locked.id)).toBeLessThan(ids.indexOf(open.id));

    const item = lobby.matches.find((m) => m.id === open.id)!;
    expect(item).toMatchObject({
      creatorName: "Test Person",
      cellCount: 36,
      gateCount: 0,
      access: "open",
      request: "none",
    });
    expect(item.deadlineAt).toBeInstanceOf(Date);
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item).not.toHaveProperty("code");
  });

  it("omits the caller's own, drawing and expired matches", async () => {
    const own = createCaller(await signedIn());
    const drawingCreator = createCaller(await signedIn());
    const drawingJoiner = createCaller(await signedIn());
    const expiredCreator = createCaller(await signedIn());
    const viewer = createCaller(await signedIn());

    const mine = await own.match.create(settings);
    const drawing = await drawingCreator.match.create(settings);
    await drawingJoiner.match.join({ matchId: drawing.id });
    const expired = await expiredCreator.match.create(settings);
    await db
      .update(match)
      .set({ deadlineAt: new Date(Date.now() - 60_000) })
      .where(eq(match.id, expired.id));

    const ownLobby = await own.match.lobby();
    expect(ownLobby.matches.map((m) => m.id)).not.toContain(mine.id);

    const ids = (await viewer.match.lobby()).matches.map((m) => m.id);
    expect(ids).not.toContain(drawing.id);
    expect(ids).not.toContain(expired.id);
  });

  it("reads request state from match_request rows", async () => {
    const creatorCtx = await signedIn();
    const creator = createCaller(creatorCtx);
    const pendingCtx = await signedIn();
    const declinedCtx = await signedIn();
    const created = await creator.match.create({
      ...settings,
      access: "locked",
    });
    await db.insert(matchRequest).values([
      { matchId: created.id, userId: pendingCtx.session!.user.id },
      {
        matchId: created.id,
        userId: declinedCtx.session!.user.id,
        declinedAt: new Date(),
      },
    ]);

    const find = async (ctx: typeof pendingCtx) =>
      (await createCaller(ctx).match.lobby()).matches.find(
        (m) => m.id === created.id,
      );
    expect((await find(pendingCtx))?.request).toBe("pending");
    expect((await find(declinedCtx))?.request).toBe("declined");
  });

  it("request is pending after requestJoin", async () => {
    const creator = createCaller(await signedIn());
    const viewer = createCaller(await signedIn());
    const created = await creator.match.create({
      ...settings,
      access: "locked",
    });
    await viewer.match.requestJoin({ matchId: created.id });
    const seen = (await viewer.match.lobby()).matches.find(
      (m) => m.id === created.id,
    );
    expect(seen?.request).toBe("pending");
  });

  it("request is declined after declineRequest", async () => {
    const creator = createCaller(await signedIn());
    const viewerCtx = await signedIn();
    const viewer = createCaller(viewerCtx);
    const created = await creator.match.create({
      ...settings,
      access: "locked",
    });
    await viewer.match.requestJoin({ matchId: created.id });
    await creator.match.declineRequest({
      matchId: created.id,
      userId: viewerCtx.session!.user.id,
    });
    const seen = (await viewer.match.lobby()).matches.find(
      (m) => m.id === created.id,
    );
    expect(seen?.request).toBe("declined");
  });
});

describe("match.preview", () => {
  it("returns a waiting match without a code", async () => {
    const creator = createCaller(await signedIn());
    const viewer = createCaller(await signedIn());
    const created = await creator.match.create({
      ...settings,
      access: "locked",
    });

    const seen = await viewer.match.preview({ matchId: created.id });
    expect(seen).toMatchObject({
      id: created.id,
      access: "locked",
      isYours: false,
      request: "none",
    });
    expect(seen).not.toHaveProperty("code");
  });

  it("succeeds with isYours for the creator's own waiting match", async () => {
    const creator = createCaller(await signedIn());
    const created = await creator.match.create(settings);
    const seen = await creator.match.preview({ matchId: created.id });
    expect(seen.isYours).toBe(true);
  });

  it("rejects an empty match id instead of previewing the newest match", async () => {
    const creator = createCaller(await signedIn());
    const viewer = createCaller(await signedIn());
    await creator.match.create(settings);
    await expect(viewer.match.preview({ matchId: "" })).rejects.toThrow();
  });

  it("is NOT_FOUND with one message for unknown, expired and drawing", async () => {
    const viewer = createCaller(await signedIn());
    const expiredCreator = createCaller(await signedIn());
    const drawingCreator = createCaller(await signedIn());
    const drawingJoiner = createCaller(await signedIn());

    const expired = await expiredCreator.match.create(settings);
    await db
      .update(match)
      .set({ deadlineAt: new Date(Date.now() - 60_000) })
      .where(eq(match.id, expired.id));
    const drawing = await drawingCreator.match.create(settings);
    await drawingJoiner.match.join({ matchId: drawing.id });

    const results = await Promise.all(
      ["no-such-match", expired.id, drawing.id].map((matchId) =>
        rejection(viewer.match.preview({ matchId })),
      ),
    );
    for (const r of results) {
      expect(r).toEqual({
        code: "NOT_FOUND",
        message: "errors.matchNotFound",
      });
    }
  });
});

describe("match.get access", () => {
  it("reports access and isCreator", async () => {
    const creator = createCaller(await signedIn());
    const joiner = createCaller(await signedIn());
    const created = await creator.match.create({
      ...settings,
      access: "open",
    });
    await joiner.match.join({ matchId: created.id });

    const asCreator = await creator.match.get({ id: created.id });
    const asJoiner = await joiner.match.get({ id: created.id });
    expect(asCreator).toMatchObject({ access: "open", isCreator: true });
    expect(asJoiner).toMatchObject({ access: "open", isCreator: false });
  });
});

describe("lobby and preview without a session", () => {
  const visitor = async () =>
    createCaller(await createTRPCContext({ headers: new Headers() }));

  it("lists a member's open match with no request state", async () => {
    const creator = createCaller(await signedIn());
    const open = await creator.match.create({ ...settings, access: "open" });

    const lobby = await (await visitor()).match.lobby();
    expect(lobby.you).toBeNull();
    const item = lobby.matches.find((m) => m.id === open.id)!;
    expect(item).toMatchObject({ access: "open", request: "none" });
    expect(item).not.toHaveProperty("code");
  });

  it("previews a locked match as not the visitor's own", async () => {
    const creator = createCaller(await signedIn());
    const locked = await creator.match.create({
      ...settings,
      access: "locked",
    });

    const preview = await (
      await visitor()
    ).match.preview({ matchId: locked.id });
    expect(preview).toMatchObject({
      id: locked.id,
      access: "locked",
      isYours: false,
      request: "none",
    });
  });

  it("still refuses match.join", async () => {
    const creator = createCaller(await signedIn());
    const open = await creator.match.create(settings);

    const error = await rejection(
      (await visitor()).match.join({ matchId: open.id }),
    );
    expect(error).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
