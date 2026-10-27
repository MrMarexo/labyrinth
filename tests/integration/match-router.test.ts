import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { CODE_LENGTH, HOURS_24_MS, HOURS_48_MS } from "~/match";
import { emptyDraft } from "~/maze";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { match, matchPlayer, maze } from "~/server/db/schema";

import {
  SOLVABLE_MAZE_CELL_COUNT,
  SOLVABLE_MAZE_GATE_COUNT,
  solvableDraft,
} from "../fixtures/maze";
import { runningMatch } from "./players";
import { rejection, sweepAll } from "./support";

async function signedIn() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

/** A saved, valid labyrinth owned by the caller, ready to submit. */
async function savedMaze(
  caller: ReturnType<typeof createCaller>,
  name = "Mine",
) {
  const created = await caller.maze.createConcept({
    name,
    cellCount: SOLVABLE_MAZE_CELL_COUNT,
    gateCount: SOLVABLE_MAZE_GATE_COUNT,
    replace: true,
  });
  const { version } = await caller.maze.saveDraft({
    id: created.id,
    data: solvableDraft(),
    expectedVersion: 0,
  });
  const saved = await caller.maze.saveConcept({
    id: created.id,
    expectedVersion: version,
  });
  return saved.id;
}

const settings = { cellCount: 36 as const, gateCount: 0 };

/**
 * Ends a match outright, so its players may start another (one active match
 * at a time). What the tests below care about is who submitted what, which
 * this leaves alone.
 */
async function endMatch(matchId: string) {
  await db
    .update(match)
    .set({ status: "abandoned", endReason: "abandoned", endedAt: new Date() })
    .where(eq(match.id, matchId));
}

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
    // One waiting match per creator, so each match gets its own.
    const a = await createCaller(await signedIn()).match.create(settings);
    const b = await createCaller(await signedIn()).match.create(settings);
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

describe("match.create access and the one-waiting rule", () => {
  it("stores the requested access, open by default", async () => {
    const open = await createCaller(await signedIn()).match.create(settings);
    const locked = await createCaller(await signedIn()).match.create({
      ...settings,
      access: "locked",
    });

    const rows = await db
      .select({ id: match.id, access: match.access })
      .from(match)
      .where(inArray(match.id, [open.id, locked.id]));
    expect(rows.find((r) => r.id === open.id)?.access).toBe("open");
    expect(rows.find((r) => r.id === locked.id)?.access).toBe("locked");
  });

  it("refuses a second match while one is waiting", async () => {
    const host = createCaller(await signedIn());
    await host.match.create(settings);

    expect(await rejection(host.match.create(settings))).toEqual({
      code: "CONFLICT",
      message: "errors.alreadyWaiting",
    });
  });

  it("abandons an expired waiting match and creates the new one", async () => {
    const host = createCaller(await signedIn());
    const old = await host.match.create(settings);
    await db
      .update(match)
      // Row 1 of §9.1 is recomputed from `createdAt`, not read from the column.
      .set({
        createdAt: new Date(Date.now() - HOURS_24_MS - 2000),
        deadlineAt: new Date(Date.now() - 1000),
      })
      .where(eq(match.id, old.id));

    const next = await host.match.create(settings);

    expect(next.id).not.toBe(old.id);
    const [row] = await db.select().from(match).where(eq(match.id, old.id));
    expect(row?.status).toBe("abandoned");
  });

  it("still refuses another match once the first has an opponent", async () => {
    const host = createCaller(await signedIn());
    const first = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: first.id });

    // Drawing holds the player just as waiting did (one active match).
    expect(await rejection(host.match.create(settings))).toEqual({
      code: "CONFLICT",
      message: "errors.alreadyActive",
    });
  });
});

describe("match.join", () => {
  it("seats the second player and moves the match to drawing", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guestCtx = await signedIn();
    const guest = createCaller(guestCtx);

    const joined = await guest.match.join({ matchId: created.id });

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

    await guest.match.join({ matchId: created.id });

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    const gap = row!.deadlineAt.getTime() - row!.lastActivityAt.getTime();
    expect(gap).toBe(HOURS_48_MS);
  });

  it("refuses a third player", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });

    const third = createCaller(await signedIn());
    expect(await rejection(third.match.join({ matchId: created.id }))).toEqual({
      code: "CONFLICT",
      message: "errors.matchFull",
    });
  });

  it("refuses the host joining their own match", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);

    expect(await rejection(host.match.join({ matchId: created.id }))).toEqual({
      code: "CONFLICT",
      message: "errors.alreadyInMatch",
    });
  });

  it("refuses an unknown match id", async () => {
    const guest = createCaller(await signedIn());
    expect(
      await rejection(guest.match.join({ matchId: crypto.randomUUID() })),
    ).toEqual({ code: "NOT_FOUND", message: "errors.matchNotFound" });
  });

  it("refuses a locked match", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create({ ...settings, access: "locked" });
    const guest = createCaller(await signedIn());

    expect(await rejection(guest.match.join({ matchId: created.id }))).toEqual({
      code: "CONFLICT",
      message: "errors.matchLocked",
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
    expect(await rejection(guest.match.join({ matchId: created.id }))).toEqual({
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
    await createCaller(await signedIn()).match.join({ matchId: created.id });

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
    await createCaller(await signedIn()).match.join({ matchId: created.id });

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
    await createCaller(await signedIn()).match.join({ matchId: first.id });
    await endMatch(first.id);
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
    await guest.match.join({ matchId: created.id });

    const listed = await guest.match.list();
    expect(listed.map((m) => m.id)).toContain(created.id);
  });

  it("says which player won, from each player's side", async () => {
    const { host, guest, matchId } = await runningMatch();
    await guest.run.giveUp({ matchId });

    const forHost = (await host.match.list()).find((m) => m.id === matchId);
    const forGuest = (await guest.match.list()).find((m) => m.id === matchId);
    expect(forHost?.won).toBe(true);
    expect(forGuest?.won).toBe(false);
  });
});

describe("match.submitMaze", () => {
  it("records the submission and holds the match in drawing until both are in", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    const mazeId = await savedMaze(host);

    const result = await host.match.submitMaze({
      matchId: created.id,
      mazeId,
    });

    expect(result.status).toBe("drawing");
    const [player] = await db
      .select()
      .from(matchPlayer)
      .where(
        and(
          eq(matchPlayer.matchId, created.id),
          eq(matchPlayer.userId, hostCtx.session!.user.id),
        ),
      );
    expect(player?.mazeId).toBe(mazeId);
    expect(player?.submittedAt).not.toBeNull();
  });

  it("marks the maze submitted, so the editor can no longer change it", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    const mazeId = await savedMaze(host);

    await host.match.submitMaze({ matchId: created.id, mazeId });

    const [row] = await db.select().from(maze).where(eq(maze.id, mazeId));
    expect(row?.status).toBe("submitted");
    expect(row?.contentHash).not.toBeNull();
    expect(row?.optimalMoves).not.toBeNull();

    expect(
      await rejection(
        host.maze.saveDraft({
          id: mazeId,
          data: solvableDraft(),
          // The version it is at: only the status refuses this.
          expectedVersion: 1,
        }),
      ),
    ).toEqual({ code: "FORBIDDEN", message: "errors.mazeIsSubmitted" });
  });

  it("moves the deadline to row 3's 24h from the submission", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    const mazeId = await savedMaze(host);

    await host.match.submitMaze({ matchId: created.id, mazeId });

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    // The submitting player is the host, whose context this test already
    // holds — no need to search across both seats for a non-null stamp.
    const [player] = await db
      .select()
      .from(matchPlayer)
      .where(
        and(
          eq(matchPlayer.matchId, created.id),
          eq(matchPlayer.userId, hostCtx.session!.user.id),
        ),
      );
    const submittedAt = player!.submittedAt!;
    expect(row!.deadlineAt.getTime() - submittedAt.getTime()).toBe(HOURS_24_MS);
  });

  it("unlocks the runs once both have submitted", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());
    await guest.match.join({ matchId: created.id });

    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "Host"),
    });
    const result = await guest.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(guest, "Guest"),
    });

    expect(result.status).toBe("running");
    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("running");
  });

  it("sets row 4's 24h deadline from the moment the runs unlocked", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());
    await guest.match.join({ matchId: created.id });

    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "Host"),
    });
    await guest.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(guest, "Guest"),
    });

    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));
    const unlockedAt = Math.max(
      ...players.map((p) => p.submittedAt!.getTime()),
    );
    expect(row!.deadlineAt.getTime() - unlockedAt).toBe(HOURS_24_MS);
  });

  it("refuses a maze whose settings do not match the match", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create({ cellCount: 64, gateCount: 0 });
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    // The fixture is a 36-cell maze; this match wants 64.
    const mazeId = await savedMaze(host);

    expect(
      await rejection(host.match.submitMaze({ matchId: created.id, mazeId })),
    ).toEqual({
      code: "BAD_REQUEST",
      message: "errors.mazeSettingsMismatch",
    });
  });

  it("saves a concept it is given into the library as used", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    const concept = await host.maze.createConcept({
      name: "Fresh",
      ...settings,
    });
    await host.maze.saveDraft({
      id: concept.id,
      data: solvableDraft(),
      expectedVersion: 0,
    });

    await host.match.submitMaze({ matchId: created.id, mazeId: concept.id });

    const [row] = await db.select().from(maze).where(eq(maze.id, concept.id));
    expect(row).toMatchObject({ concept: false, status: "submitted" });
    expect((await host.maze.list()).map((m) => m.state)).toEqual(["used"]);
  });

  it("uses an edit of a ready labyrinth as that labyrinth, with the edit in it", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    const original = await savedMaze(host, "Original");
    const concept = await host.maze.editAsConcept({
      id: original,
      copyName: "unused",
    });
    const opened = await host.maze.get({ id: concept.id });
    const moved = { ...solvableDraft(), treasure: { x: 0, y: 5 } };
    await host.maze.saveDraft({
      id: concept.id,
      data: moved,
      expectedVersion: opened.version,
    });

    await host.match.submitMaze({ matchId: created.id, mazeId: concept.id });

    const [row] = await db.select().from(maze).where(eq(maze.id, original));
    expect(row).toMatchObject({ status: "submitted", data: moved });
    const [gone] = await db.select().from(maze).where(eq(maze.id, concept.id));
    expect(gone).toBeUndefined();
    const [seat] = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.userId, hostCtx.session!.user.id));
    expect(seat?.mazeId).toBe(original);
  });

  it("refuses a maze that does not validate", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    // Created but never drawn: no start, no treasure, no cells.
    const empty = await host.maze.createConcept({
      name: "Empty",
      cellCount: SOLVABLE_MAZE_CELL_COUNT,
      gateCount: SOLVABLE_MAZE_GATE_COUNT,
    });

    expect(
      await rejection(
        host.match.submitMaze({ matchId: created.id, mazeId: empty.id }),
      ),
    ).toEqual({ code: "BAD_REQUEST", message: "errors.mazeInvalid" });
  });

  it("refuses someone else's maze, indistinguishably from one that does not exist", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const guest = createCaller(await signedIn());
    await guest.match.join({ matchId: created.id });
    const guestMaze = await savedMaze(guest, "Not yours");

    const notMine = await rejection(
      host.match.submitMaze({ matchId: created.id, mazeId: guestMaze }),
    );
    const missing = await rejection(
      host.match.submitMaze({
        matchId: created.id,
        mazeId: crypto.randomUUID(),
      }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMaze",
    });
    expect(missing).toEqual(notMine);
  });

  it("refuses a second submission from the same player", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    await host.match.submitMaze({
      matchId: created.id,
      mazeId: await savedMaze(host, "First"),
    });

    expect(
      await rejection(
        host.match.submitMaze({
          matchId: created.id,
          mazeId: await savedMaze(host, "Second"),
        }),
      ),
    ).toEqual({ code: "CONFLICT", message: "errors.alreadySubmitted" });
  });

  it("refuses a submission before anyone has joined", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const mazeId = await savedMaze(host);

    expect(
      await rejection(host.match.submitMaze({ matchId: created.id, mazeId })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchNotDrawing" });
  });

  it("refuses a submission once the match's deadline has already passed", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    const mazeId = await savedMaze(host);

    await db
      .update(match)
      .set({ deadlineAt: new Date(Date.now() - 1000) })
      .where(eq(match.id, created.id));

    expect(
      await rejection(host.match.submitMaze({ matchId: created.id, mazeId })),
    ).toEqual({ code: "CONFLICT", message: "errors.matchExpired" });
  });

  it("refuses a stranger, indistinguishably from a match that does not exist", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    const strangerCtx = await signedIn();
    const stranger = createCaller(strangerCtx);
    const theirMaze = await savedMaze(stranger, "Theirs");

    const notMine = await rejection(
      stranger.match.submitMaze({ matchId: created.id, mazeId: theirMaze }),
    );
    const missing = await rejection(
      stranger.match.submitMaze({
        matchId: crypto.randomUUID(),
        mazeId: theirMaze,
      }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
    expect(missing).toEqual(notMine);
  });

  it("lets a submitted maze be reused against a different opponent", async () => {
    const host = createCaller(await signedIn());
    const first = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: first.id });
    const mazeId = await savedMaze(host, "Reused");
    await host.match.submitMaze({ matchId: first.id, mazeId });
    await endMatch(first.id);

    const second = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: second.id });

    const result = await host.match.submitMaze({
      matchId: second.id,
      mazeId,
    });
    expect(result.status).toBe("drawing");
  });

  it("refuses reuse against an opponent who has already faced that maze", async () => {
    const host = createCaller(await signedIn());
    const rivalCtx = await signedIn();
    const rival = createCaller(rivalCtx);

    const first = await host.match.create(settings);
    await rival.match.join({ matchId: first.id });
    const mazeId = await savedMaze(host, "Seen it");
    await host.match.submitMaze({ matchId: first.id, mazeId });
    // The rival must submit too: the match only reaches `running` — the
    // point at which they could actually see the host's maze — once both
    // have.
    await rival.match.submitMaze({
      matchId: first.id,
      mazeId: await savedMaze(rival, "Rival's own"),
    });
    await endMatch(first.id);

    const second = await host.match.create(settings);
    await rival.match.join({ matchId: second.id });

    expect(
      await rejection(host.match.submitMaze({ matchId: second.id, mazeId })),
    ).toEqual({ code: "CONFLICT", message: "errors.mazeAlreadyFaced" });
  });

  it("treats an unchanged copy as the maze it was copied from", async () => {
    const host = createCaller(await signedIn());
    const rival = createCaller(await signedIn());

    const first = await host.match.create(settings);
    await rival.match.join({ matchId: first.id });
    const mazeId = await savedMaze(host, "Seen it");
    await host.match.submitMaze({ matchId: first.id, mazeId });
    await rival.match.submitMaze({
      matchId: first.id,
      mazeId: await savedMaze(rival, "Rival's own"),
    });
    await endMatch(first.id);

    const copy = await host.maze.editAsConcept({
      id: mazeId,
      copyName: "Edit of Seen it",
    });
    const second = await host.match.create(settings);
    await rival.match.join({ matchId: second.id });

    const offered = await host.match.eligibleMazes({ matchId: second.id });
    expect(offered.map((m) => m.id)).not.toContain(copy.id);
    expect(
      await rejection(
        host.match.submitMaze({ matchId: second.id, mazeId: copy.id }),
      ),
    ).toEqual({ code: "CONFLICT", message: "errors.mazeAlreadyFaced" });
  });

  it("releases a maze from a match the sweep abandoned during drawing", async () => {
    const host = createCaller(await signedIn());
    const rivalCtx = await signedIn();
    const rival = createCaller(rivalCtx);

    const first = await host.match.create(settings);
    await rival.match.join({ matchId: first.id });
    const mazeId = await savedMaze(host, "Never seen");
    await host.match.submitMaze({ matchId: first.id, mazeId });

    // The rival never draws. The match stays in `drawing` — it never
    // reaches `running` — until the sweep gives up on it at row 3's
    // deadline, 24h from the host's submission.
    await sweepAll(db, new Date(Date.now() + HOURS_24_MS + 1000));
    const [abandonedRow] = await db
      .select()
      .from(match)
      .where(eq(match.id, first.id));
    expect(abandonedRow?.status).toBe("abandoned");

    // The opponent never saw it, so it is not faced: offered again, and
    // accepted, against the very same opponent.
    const second = await host.match.create(settings);
    await rival.match.join({ matchId: second.id });

    const offered = await host.match.eligibleMazes({ matchId: second.id });
    expect(offered.map((m) => m.id)).toContain(mazeId);

    const result = await host.match.submitMaze({
      matchId: second.id,
      mazeId,
    });
    expect(result.status).toBe("drawing");
  });

  it("still refuses reuse once the match that exposed the maze decays to abandoned", async () => {
    const host = createCaller(await signedIn());
    const rivalCtx = await signedIn();
    const rival = createCaller(rivalCtx);

    const first = await host.match.create(settings);
    await rival.match.join({ matchId: first.id });
    const mazeId = await savedMaze(host, "Seen it, then abandoned");
    await host.match.submitMaze({ matchId: first.id, mazeId });
    await rival.match.submitMaze({
      matchId: first.id,
      mazeId: await savedMaze(rival, "Rival's own"),
    });

    const [running] = await db
      .select()
      .from(match)
      .where(eq(match.id, first.id));
    expect(running?.status).toBe("running");

    // Phase 3 has no move or finish procedure, so `finishedAt` never gets
    // set and a running match's row-4 deadline (24h from the moment the
    // runs unlocked) can only ever resolve to `abandoned` — this is not a
    // contrived edge case, it is what every running match in this phase
    // becomes within a day. The opponent already saw the maze the moment
    // both submitted; that must not un-happen just because the match's
    // current status later moved on.
    await sweepAll(db, new Date(Date.now() + HOURS_24_MS + 1000));
    const [abandonedRow] = await db
      .select()
      .from(match)
      .where(eq(match.id, first.id));
    expect(abandonedRow?.status).toBe("abandoned");

    const second = await host.match.create(settings);
    await rival.match.join({ matchId: second.id });

    const offered = await host.match.eligibleMazes({ matchId: second.id });
    expect(offered.map((m) => m.id)).not.toContain(mazeId);

    expect(
      await rejection(host.match.submitMaze({ matchId: second.id, mazeId })),
    ).toEqual({ code: "CONFLICT", message: "errors.mazeAlreadyFaced" });
  });
});

describe("match.eligibleMazes", () => {
  it("offers only the caller's mazes at the match's settings", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });

    const right = await savedMaze(host, "Right size");
    const wrong = await host.maze.createConcept({
      name: "Wrong size",
      cellCount: 64,
      gateCount: 0,
    });

    const offered = await host.match.eligibleMazes({ matchId: created.id });
    const ids = offered.map((m) => m.id);
    expect(ids).toContain(right);
    expect(ids).not.toContain(wrong.id);
  });

  it("omits a maze this opponent has already faced", async () => {
    const host = createCaller(await signedIn());
    const rival = createCaller(await signedIn());
    const first = await host.match.create(settings);
    await rival.match.join({ matchId: first.id });
    const mazeId = await savedMaze(host, "Seen it");
    await host.match.submitMaze({ matchId: first.id, mazeId });
    // Both must submit for the match to reach `running` — see the
    // `submitMaze` describe block's "refuses reuse..." test for why.
    await rival.match.submitMaze({
      matchId: first.id,
      mazeId: await savedMaze(rival, "Rival's own"),
    });
    await endMatch(first.id);

    const second = await host.match.create(settings);
    await rival.match.join({ matchId: second.id });

    const offered = await host.match.eligibleMazes({ matchId: second.id });
    expect(offered.map((m) => m.id)).not.toContain(mazeId);
  });

  it("omits a saved labyrinth that never validated, so the picker never offers what submitMaze would reject", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });

    // Saved before concepts existed, never drawn: no `contentHash`.
    const [legacy] = await db
      .insert(maze)
      .values({
        authorId: hostCtx.session!.user.id,
        name: "Half-drawn",
        cellCount: settings.cellCount,
        gateCount: settings.gateCount,
        data: emptyDraft(),
      })
      .returning({ id: maze.id });

    const offered = await host.match.eligibleMazes({ matchId: created.id });
    expect(offered.map((m) => m.id)).not.toContain(legacy!.id);
  });

  it("offers the concept at the match's settings, marked valid or not", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });

    const concept = await host.maze.createConcept({
      name: "Half-drawn",
      ...settings,
    });
    let offered = await host.match.eligibleMazes({ matchId: created.id });
    expect(offered.find((m) => m.id === concept.id)).toMatchObject({
      concept: true,
      valid: false,
    });

    await host.maze.saveDraft({
      id: concept.id,
      data: solvableDraft(),
      expectedVersion: 0,
    });
    offered = await host.match.eligibleMazes({ matchId: created.id });
    expect(offered.find((m) => m.id === concept.id)).toMatchObject({
      concept: true,
      valid: true,
    });

    await host.maze.createConcept({
      name: "Other size",
      cellCount: 64,
      gateCount: 0,
      replace: true,
    });
    offered = await host.match.eligibleMazes({ matchId: created.id });
    expect(offered.some((m) => m.concept)).toBe(false);
  });

  it("refuses a stranger, indistinguishably from a match that does not exist", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });
    const stranger = createCaller(await signedIn());

    const notMine = await rejection(
      stranger.match.eligibleMazes({ matchId: created.id }),
    );
    const missing = await rejection(
      stranger.match.eligibleMazes({ matchId: crypto.randomUUID() }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
    expect(missing).toEqual(notMine);
  });
});

describe("match.eligibleMazes data", () => {
  it("returns each offered maze's own drawing, and never the opponent's", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    const guest = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await guest.match.join({ matchId: created.id });

    const mine = await savedMaze(host, "Mine with data");
    const theirs = await savedMaze(guest, "Theirs with data");

    const offered = await host.match.eligibleMazes({ matchId: created.id });
    expect(offered.map((m) => m.id)).not.toContain(theirs);
    expect(offered.find((m) => m.id === mine)?.data).toEqual(solvableDraft());

    // Every drawing returned belongs to the caller (invariant 1).
    const rows = await db
      .select({ id: maze.id, authorId: maze.authorId })
      .from(maze)
      .where(
        inArray(
          maze.id,
          offered.map((m) => m.id),
        ),
      );
    expect(rows).toHaveLength(offered.length);
    for (const row of rows) {
      expect(row.authorId).toBe(hostCtx.session!.user.id);
    }
  });
});

describe("match.cancel", () => {
  it("deletes a waiting match and its players, then publishes", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);

    expect(await host.match.cancel({ matchId: created.id })).toEqual({
      id: created.id,
    });

    expect(
      await db.select().from(match).where(eq(match.id, created.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(matchPlayer)
        .where(eq(matchPlayer.matchId, created.id)),
    ).toEqual([]);
    expect((await host.match.list()).map((m) => m.id)).not.toContain(
      created.id,
    );
  });

  it("refuses once the match is drawing", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: created.id });

    expect(await rejection(host.match.cancel({ matchId: created.id }))).toEqual(
      { code: "CONFLICT", message: "errors.matchNotCancellable" },
    );
    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("drawing");
  });

  it("refuses a stranger, indistinguishably from a match that does not exist", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    const stranger = createCaller(await signedIn());

    const notMine = await rejection(
      stranger.match.cancel({ matchId: created.id }),
    );
    const missing = await rejection(
      stranger.match.cancel({ matchId: crypto.randomUUID() }),
    );
    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
    expect(missing).toEqual(notMine);
    const [row] = await db.select().from(match).where(eq(match.id, created.id));
    expect(row?.status).toBe("awaiting_opponent");
  });

  it("leaves the match unknown to anyone joining afterwards", async () => {
    const host = createCaller(await signedIn());
    const created = await host.match.create(settings);
    await host.match.cancel({ matchId: created.id });

    expect(
      await rejection(
        createCaller(await signedIn()).match.join({ matchId: created.id }),
      ),
    ).toEqual({ code: "NOT_FOUND", message: "errors.matchNotFound" });
  });
});

/** A settled tRPC call's error as `{ code, message }`, or its status. */
function failure(result: PromiseSettledResult<unknown>) {
  if (result.status === "rejected" && result.reason instanceof TRPCError) {
    return { code: result.reason.code, message: result.reason.message };
  }
  return result.status;
}

describe("match.cancel racing match.join", () => {
  it("ends in exactly one of the two valid states", async () => {
    const host = createCaller(await signedIn());
    const guest = createCaller(await signedIn());
    const created = await host.match.create(settings);

    const [cancelled, joined] = await Promise.allSettled([
      host.match.cancel({ matchId: created.id }),
      guest.match.join({ matchId: created.id }),
    ]);

    const rows = await db.select().from(match).where(eq(match.id, created.id));
    const players = await db
      .select()
      .from(matchPlayer)
      .where(eq(matchPlayer.matchId, created.id));

    if (cancelled.status === "fulfilled") {
      // The cancel won: the match is gone and the join found nothing.
      expect(rows).toEqual([]);
      expect(players).toEqual([]);
      expect(failure(joined)).toEqual({
        code: "NOT_FOUND",
        message: "errors.matchNotFound",
      });
    } else {
      // The join won: both are seated and the cancel was refused.
      expect(joined.status).toBe("fulfilled");
      expect(failure(cancelled)).toEqual({
        code: "CONFLICT",
        message: "errors.matchNotCancellable",
      });
      expect(rows[0]?.status).toBe("drawing");
      expect(players).toHaveLength(2);
    }
  });
});

describe("a deleted used labyrinth", () => {
  /** A labyrinth `host` used in a match that reached running, then deleted. */
  async function usedThenDeleted() {
    const host = createCaller(await signedIn());
    const rival = createCaller(await signedIn());
    const first = await host.match.create(settings);
    await rival.match.join({ matchId: first.id });
    const mazeId = await savedMaze(host, "Used");
    await host.match.submitMaze({ matchId: first.id, mazeId });
    await rival.match.submitMaze({
      matchId: first.id,
      mazeId: await savedMaze(rival, "Rival's"),
    });
    await host.maze.remove({ id: mazeId });
    await endMatch(first.id);
    return { host, mazeId };
  }

  it("is neither offered nor accepted in a new match", async () => {
    const { host, mazeId } = await usedThenDeleted();
    const next = await host.match.create(settings);
    await createCaller(await signedIn()).match.join({ matchId: next.id });

    const offered = await host.match.eligibleMazes({ matchId: next.id });
    expect(offered.map((m) => m.id)).not.toContain(mazeId);
    await expect(
      rejection(host.match.submitMaze({ matchId: next.id, mazeId })),
    ).resolves.toEqual({ code: "FORBIDDEN", message: "errors.notYourMaze" });
  });
});
