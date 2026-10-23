import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { MAZE_LIMIT, emptyDraft } from "~/maze";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { maze } from "~/server/db/schema";

import {
  SOLVABLE_MAZE_CELL_COUNT,
  SOLVABLE_MAZE_GATE_COUNT,
  SOLVABLE_MAZE_OPTIMAL_MOVES,
  solvableDraft,
} from "../fixtures/maze";
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

const settings = { name: "First", cellCount: 36 as const, gateCount: 2 };

describe("maze.createDraft", () => {
  it("creates an empty draft owned by the caller", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);

    const created = await caller.maze.createDraft(settings);

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row?.authorId).toBe(ctx.session!.user.id);
    expect(row?.status).toBe("draft");
    expect(row?.contentHash).toBeNull();
    expect(row?.data).toEqual(emptyDraft());
  });

  it("rejects a cell count that is not a preset", async () => {
    const caller = createCaller(await signedIn());
    await expect(
      rejection(caller.maze.createDraft({ ...settings, cellCount: 37 })),
    ).resolves.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an anonymous caller with a message key", async () => {
    const caller = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    await expect(rejection(caller.maze.createDraft(settings))).resolves.toEqual(
      { code: "UNAUTHORIZED", message: "errors.notSignedIn" },
    );
  });
});

describe("maze.saveDraft", () => {
  it("stores the draft and leaves derived columns null while invalid", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);

    const result = await caller.maze.saveDraft({
      id: created.id,
      data: { ...emptyDraft(), cells: [{ x: 0, y: 0 }] },
      expectedVersion: 0,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row?.contentHash).toBeNull();
    expect(row?.optimalMoves).toBeNull();
  });

  it("computes and persists derived metrics for a valid maze", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft({
      ...settings,
      cellCount: SOLVABLE_MAZE_CELL_COUNT,
      gateCount: SOLVABLE_MAZE_GATE_COUNT,
    });

    const result = await caller.maze.saveDraft({
      id: created.id,
      data: solvableDraft(),
      expectedVersion: 0,
    });

    expect(result).toEqual({ valid: true, issues: [], version: 1 });

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row?.contentHash).not.toBeNull();
    expect(row?.optimalMoves).toBe(SOLVABLE_MAZE_OPTIMAL_MOVES);
  });

  it("refuses someone else's maze, indistinguishably from a missing one", async () => {
    const owner = createCaller(await signedIn());
    const created = await owner.maze.createDraft(settings);
    const stranger = createCaller(await signedIn());

    const notMine = await rejection(
      stranger.maze.saveDraft({
        id: created.id,
        data: emptyDraft(),
        expectedVersion: 0,
      }),
    );
    const missing = await rejection(
      stranger.maze.saveDraft({
        id: crypto.randomUUID(),
        data: emptyDraft(),
        expectedVersion: 0,
      }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMaze",
    });
    // The invariant stated directly: a maze that belongs to someone else must
    // be indistinguishable from one that does not exist at all.
    expect(missing).toEqual(notMine);
  });
  it("starts at version 0 and counts up one per save", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);
    expect((await caller.maze.get({ id: created.id })).version).toBe(0);

    const first = await caller.maze.saveDraft({
      id: created.id,
      data: { ...emptyDraft(), cells: [{ x: 0, y: 0 }] },
      expectedVersion: 0,
    });
    const second = await caller.maze.saveDraft({
      id: created.id,
      data: { ...emptyDraft(), cells: [{ x: 1, y: 0 }] },
      expectedVersion: first.version,
    });

    expect([first.version, second.version]).toEqual([1, 2]);
    expect((await caller.maze.get({ id: created.id })).version).toBe(2);
  });

  it("refuses a save from a stale version and leaves the stored draft alone", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);
    const kept = { ...emptyDraft(), cells: [{ x: 0, y: 0 }] };
    await caller.maze.saveDraft({
      id: created.id,
      data: kept,
      expectedVersion: 0,
    });

    // A second editor that loaded the maze before that save.
    await expect(
      rejection(
        caller.maze.saveDraft({
          id: created.id,
          data: { ...emptyDraft(), cells: [{ x: 1, y: 0 }] },
          expectedVersion: 0,
        }),
      ),
    ).resolves.toEqual({
      code: "CONFLICT",
      message: "errors.draftChangedElsewhere",
    });

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row?.data).toEqual(kept);
    expect(row?.version).toBe(1);
  });

  it("still refuses a submitted maze as submitted, whatever the version", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);
    await db
      .update(maze)
      .set({ status: "submitted" })
      .where(eq(maze.id, created.id));

    for (const expectedVersion of [0, 7]) {
      await expect(
        rejection(
          caller.maze.saveDraft({
            id: created.id,
            data: emptyDraft(),
            expectedVersion,
          }),
        ),
      ).resolves.toEqual({
        code: "FORBIDDEN",
        message: "errors.mazeIsSubmitted",
      });
    }
    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row?.version).toBe(0);
  });
});

describe("maze.list", () => {
  it("returns only the caller's mazes, newest first", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    const first = await caller.maze.createDraft({ ...settings, name: "One" });
    const second = await caller.maze.createDraft({ ...settings, name: "Two" });

    const stranger = createCaller(await signedIn());
    await stranger.maze.createDraft({ ...settings, name: "Theirs" });

    const mine = await caller.maze.list();
    expect(mine.map((m) => m.id)).toEqual([second.id, first.id]);
    expect(mine.every((m) => m.name !== "Theirs")).toBe(true);
  });

  it("returns each of the caller's own drawings as a parsed preview, never the raw data column", async () => {
    const caller = createCaller(await signedIn());
    await caller.maze.createDraft(settings);
    const [summary] = await caller.maze.list();
    expect(summary).toBeDefined();
    expect(summary).not.toHaveProperty("data");
    expect(summary!.preview).toEqual(emptyDraft());
  });
});

describe("maze.get", () => {
  it("returns the caller's own maze", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);
    const fetched = await caller.maze.get({ id: created.id });
    expect(fetched.id).toBe(created.id);
    expect(fetched.data).toEqual(emptyDraft());
  });

  it("projects only what the editor and the read-only view need — status, but no authorId or derived metrics", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);
    const fetched = await caller.maze.get({ id: created.id });
    expect(Object.keys(fetched).sort()).toEqual(
      [
        "cellCount",
        "data",
        "gateCount",
        "id",
        "name",
        "status",
        "version",
      ].sort(),
    );
    expect(fetched).not.toHaveProperty("authorId");
    expect(fetched).not.toHaveProperty("contentHash");
    expect(fetched).not.toHaveProperty("optimalMoves");
    expect(fetched.status).toBe("draft");

    // The page decides read-only from this: a used labyrinth says so.
    await db
      .update(maze)
      .set({ status: "submitted" })
      .where(eq(maze.id, created.id));
    expect((await caller.maze.get({ id: created.id })).status).toBe(
      "submitted",
    );
  });

  it("refuses someone else's maze, indistinguishably from a missing one", async () => {
    const owner = createCaller(await signedIn());
    const created = await owner.maze.createDraft(settings);
    const stranger = createCaller(await signedIn());

    const notMine = await rejection(stranger.maze.get({ id: created.id }));
    const missing = await rejection(
      stranger.maze.get({ id: crypto.randomUUID() }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMaze",
    });
    // The invariant stated directly: a maze that belongs to someone else must
    // be indistinguishable from one that does not exist at all.
    expect(missing).toEqual(notMine);
  });
});

describe("maze.remove", () => {
  it("lets the owner remove their own draft", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);

    await caller.maze.remove({ id: created.id });

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row).toBeUndefined();

    await expect(
      rejection(caller.maze.get({ id: created.id })),
    ).resolves.toEqual({ code: "FORBIDDEN", message: "errors.notYourMaze" });

    const mine = await caller.maze.list();
    expect(mine.map((m) => m.id)).not.toContain(created.id);
  });

  it("refuses someone else's maze, indistinguishably from a missing one, and leaves it intact", async () => {
    const owner = createCaller(await signedIn());
    const created = await owner.maze.createDraft(settings);
    const stranger = createCaller(await signedIn());

    const notMine = await rejection(stranger.maze.remove({ id: created.id }));
    const missing = await rejection(
      stranger.maze.remove({ id: crypto.randomUUID() }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMaze",
    });
    expect(missing).toEqual(notMine);

    // The half that actually matters: an error thrown after a successful
    // delete would also satisfy the assertions above.
    const fetched = await owner.maze.get({ id: created.id });
    expect(fetched.id).toBe(created.id);
  });

  it("rejects an anonymous caller with a message key", async () => {
    const caller = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    await expect(
      rejection(caller.maze.remove({ id: crypto.randomUUID() })),
    ).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "errors.notSignedIn",
    });
  });

  it("hides a used labyrinth from its author but keeps the row", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);
    await db
      .update(maze)
      .set({ status: "submitted" })
      .where(eq(maze.id, created.id));

    expect(await caller.maze.remove({ id: created.id })).toEqual({
      id: created.id,
    });

    expect((await caller.maze.list()).map((m) => m.id)).not.toContain(
      created.id,
    );
    const notYourMaze = { code: "FORBIDDEN", message: "errors.notYourMaze" };
    await expect(
      rejection(caller.maze.get({ id: created.id })),
    ).resolves.toEqual(notYourMaze);
    await expect(
      rejection(caller.maze.remove({ id: created.id })),
    ).resolves.toEqual(notYourMaze);

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("frees a slot when a used labyrinth is deleted", async () => {
    const caller = createCaller(await signedIn());
    for (let i = 0; i < MAZE_LIMIT; i++) {
      await caller.maze.createDraft(settings);
    }
    const [one] = await caller.maze.list();
    await db
      .update(maze)
      .set({ status: "submitted" })
      .where(eq(maze.id, one!.id));
    await caller.maze.remove({ id: one!.id });
    await expect(caller.maze.createDraft(settings)).resolves.toHaveProperty(
      "id",
    );
  });
});

/** A match in `drawing`: `host` made it at `settings`' size, a guest joined. */
async function drawingMatch() {
  const hostCtx = await signedIn();
  const host = createCaller(hostCtx);
  const created = await host.match.create({
    cellCount: settings.cellCount,
    gateCount: settings.gateCount,
  });
  await createCaller(await signedIn()).match.join({ code: created.code });
  return { host, hostId: hostCtx.session!.user.id, matchId: created.id };
}

describe("maze.draftForMatch", () => {
  it("creates an empty draft at the match's settings when there is none to reuse", async () => {
    const { host, hostId, matchId } = await drawingMatch();

    const { id } = await host.maze.draftForMatch({ matchId, name: "New" });

    const [row] = await db.select().from(maze).where(eq(maze.id, id));
    expect(row?.authorId).toBe(hostId);
    expect(row?.status).toBe("draft");
    expect(row?.name).toBe("New");
    expect(row?.cellCount).toBe(settings.cellCount);
    expect(row?.gateCount).toBe(settings.gateCount);
    expect(row?.data).toEqual(emptyDraft());
  });

  it("reuses the caller's own empty draft at the same settings instead of piling up another", async () => {
    const { host, matchId } = await drawingMatch();

    const first = await host.maze.draftForMatch({ matchId, name: "New" });
    const second = await host.maze.draftForMatch({ matchId, name: "New" });

    expect(second.id).toBe(first.id);
    const mine = await host.maze.list();
    expect(mine.map((m) => m.id)).toEqual([first.id]);
  });

  it("does not reuse a draft that has squares, one at other settings, or someone else's", async () => {
    const { host, matchId } = await drawingMatch();
    const painted = await host.maze.createDraft(settings);
    await host.maze.saveDraft({
      id: painted.id,
      data: { ...emptyDraft(), cells: [{ x: 0, y: 0 }] },
      expectedVersion: 0,
    });
    const otherSize = await host.maze.createDraft({
      ...settings,
      cellCount: 64,
    });
    const otherGates = await host.maze.createDraft({
      ...settings,
      gateCount: settings.gateCount + 1,
    });
    const stranger = createCaller(await signedIn());
    const theirs = await stranger.maze.createDraft(settings);

    const { id } = await host.maze.draftForMatch({ matchId, name: "New" });

    expect([painted.id, otherSize.id, otherGates.id, theirs.id]).not.toContain(
      id,
    );
  });

  it("refuses a caller who is not in the match, indistinguishably from a missing one", async () => {
    const { matchId } = await drawingMatch();
    const strangerCtx = await signedIn();
    const stranger = createCaller(strangerCtx);

    const notMine = await rejection(
      stranger.maze.draftForMatch({ matchId, name: "New" }),
    );
    const missing = await rejection(
      stranger.maze.draftForMatch({
        matchId: crypto.randomUUID(),
        name: "New",
      }),
    );

    expect(notMine).toEqual({
      code: "FORBIDDEN",
      message: "errors.notYourMatch",
    });
    expect(missing).toEqual(notMine);
    const rows = await db
      .select()
      .from(maze)
      .where(eq(maze.authorId, strangerCtx.session!.user.id));
    expect(rows).toHaveLength(0);
  });

  it("refuses a match that is not in drawing", async () => {
    const hostCtx = await signedIn();
    const host = createCaller(hostCtx);
    // Nobody has joined: still awaiting an opponent.
    const created = await host.match.create({
      cellCount: settings.cellCount,
      gateCount: settings.gateCount,
    });

    await expect(
      rejection(host.maze.draftForMatch({ matchId: created.id, name: "New" })),
    ).resolves.toEqual({
      code: "CONFLICT",
      message: "errors.matchNotDrawing",
    });
    const rows = await db
      .select()
      .from(maze)
      .where(eq(maze.authorId, hostCtx.session!.user.id));
    expect(rows).toHaveLength(0);
  });
});

describe("maze.discardIfEmpty", () => {
  it("deletes the caller's own empty draft", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);

    await caller.maze.discardIfEmpty({ id: created.id });

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row).toBeUndefined();
  });

  it("keeps a draft that has squares", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);
    await caller.maze.saveDraft({
      id: created.id,
      data: { ...emptyDraft(), cells: [{ x: 0, y: 0 }] },
      expectedVersion: 0,
    });

    await caller.maze.discardIfEmpty({ id: created.id });

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row).toBeDefined();
  });

  it("keeps a submitted maze, even an empty one", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createDraft(settings);
    // An empty maze can never really be submitted; set directly so the
    // status is the only thing that keeps it.
    await db
      .update(maze)
      .set({ status: "submitted" })
      .where(eq(maze.id, created.id));

    await caller.maze.discardIfEmpty({ id: created.id });

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row).toBeDefined();
  });

  it("keeps someone else's empty draft, and is a quiet no-op for them and for a missing id", async () => {
    const owner = createCaller(await signedIn());
    const created = await owner.maze.createDraft(settings);
    const stranger = createCaller(await signedIn());

    await stranger.maze.discardIfEmpty({ id: created.id });
    await stranger.maze.discardIfEmpty({ id: crypto.randomUUID() });

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row).toBeDefined();
  });

  it("rejects an anonymous caller with a message key", async () => {
    const caller = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    await expect(
      rejection(caller.maze.discardIfEmpty({ id: crypto.randomUUID() })),
    ).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "errors.notSignedIn",
    });
  });
});

describe("the labyrinth limit", () => {
  const limitReached = {
    code: "FORBIDDEN",
    message: "errors.mazeLimitReached",
  };

  async function fill(caller: ReturnType<typeof createCaller>, count: number) {
    for (let i = 0; i < count; i++) {
      await caller.maze.createDraft({ ...settings, name: `Maze ${i}` });
    }
  }

  it("refuses one more than the limit", async () => {
    const caller = createCaller(await signedIn());
    await fill(caller, MAZE_LIMIT);
    await expect(rejection(caller.maze.createDraft(settings))).resolves.toEqual(
      limitReached,
    );
  });

  it("counts used labyrinths toward the limit", async () => {
    const caller = createCaller(await signedIn());
    await fill(caller, MAZE_LIMIT);
    const [one] = await caller.maze.list();
    await db
      .update(maze)
      .set({ status: "submitted" })
      .where(eq(maze.id, one!.id));
    await expect(rejection(caller.maze.createDraft(settings))).resolves.toEqual(
      limitReached,
    );
  });

  it("lets only one of two concurrent creations take the last slot", async () => {
    const caller = createCaller(await signedIn());
    await fill(caller, MAZE_LIMIT - 1);
    const results = await Promise.allSettled([
      caller.maze.createDraft(settings),
      caller.maze.createDraft(settings),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await caller.maze.list()).toHaveLength(MAZE_LIMIT);
  });

  it("lets draftForMatch reuse an empty draft at the limit", async () => {
    const { host, matchId } = await drawingMatch();
    await fill(host, MAZE_LIMIT);
    const reused = await host.maze.draftForMatch({ matchId, name: "New" });
    expect((await host.maze.list()).map((m) => m.id)).toContain(reused.id);
    expect(await host.maze.list()).toHaveLength(MAZE_LIMIT);
  });

  it("refuses draftForMatch at the limit when nothing is reusable", async () => {
    const { host, matchId } = await drawingMatch();
    await host.maze.createDraft({ ...settings, cellCount: 64 });
    const [other] = await host.maze.list();
    for (let i = 1; i < MAZE_LIMIT; i++) {
      await host.maze.createDraft({ ...settings, cellCount: 64 });
    }
    expect(other).toBeDefined();
    await expect(
      rejection(host.maze.draftForMatch({ matchId, name: "New" })),
    ).resolves.toEqual(limitReached);
  });
});

describe("maze.list states", () => {
  it("labels each labyrinth draft, ready or used", async () => {
    const caller = createCaller(await signedIn());
    const draft = await caller.maze.createDraft({ ...settings, name: "D" });
    const ready = await caller.maze.createDraft({
      name: "R",
      cellCount: SOLVABLE_MAZE_CELL_COUNT,
      gateCount: SOLVABLE_MAZE_GATE_COUNT,
    });
    await caller.maze.saveDraft({
      id: ready.id,
      data: solvableDraft(),
      expectedVersion: 0,
    });
    const used = await caller.maze.createDraft({ ...settings, name: "U" });
    await db
      .update(maze)
      .set({ status: "submitted" })
      .where(eq(maze.id, used.id));

    const byId = new Map((await caller.maze.list()).map((m) => [m.id, m]));
    expect(byId.get(draft.id)?.state).toBe("draft");
    expect(byId.get(ready.id)?.state).toBe("ready");
    expect(byId.get(used.id)?.state).toBe("used");
    expect(byId.get(ready.id)).not.toHaveProperty("contentHash");
  });
});
