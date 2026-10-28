import { and, eq } from "drizzle-orm";
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

const solvable = {
  cellCount: SOLVABLE_MAZE_CELL_COUNT,
  gateCount: SOLVABLE_MAZE_GATE_COUNT,
} as const;

type Caller = ReturnType<typeof createCaller>;

/** A saved labyrinth, put straight in the table: library filler. */
async function savedRow(
  authorId: string,
  values: Partial<typeof maze.$inferInsert> = {},
) {
  const [row] = await db
    .insert(maze)
    .values({
      authorId,
      name: "Saved",
      cellCount: settings.cellCount,
      gateCount: settings.gateCount,
      data: emptyDraft(),
      ...values,
    })
    .returning({ id: maze.id });
  return row!;
}

/** A ready labyrinth saved the way a player saves one. */
async function savedReady(caller: Caller, name = "Ready") {
  const concept = await caller.maze.createConcept({
    name,
    ...solvable,
    replace: true,
  });
  const { version } = await caller.maze.saveDraft({
    id: concept.id,
    data: solvableDraft(),
    expectedVersion: 0,
  });
  return caller.maze.saveConcept({ id: concept.id, expectedVersion: version });
}

/** Paints one square, so the concept is no longer empty. */
async function paint(caller: Caller, id: string) {
  await caller.maze.saveDraft({
    id,
    data: { ...emptyDraft(), cells: [{ x: 0, y: 0 }] },
    expectedVersion: 0,
  });
}

async function rowOf(id: string) {
  const [row] = await db.select().from(maze).where(eq(maze.id, id));
  return row;
}

describe("maze.createConcept", () => {
  it("creates an empty concept owned by the caller", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);

    const created = await caller.maze.createConcept(settings);

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row?.authorId).toBe(ctx.session!.user.id);
    expect(row?.concept).toBe(true);
    expect(row?.contentHash).toBeNull();
    expect(row?.data).toEqual(emptyDraft());
  });

  it("refuses to replace an existing concept unless asked to", async () => {
    const caller = createCaller(await signedIn());
    const first = await caller.maze.createConcept(settings);
    await paint(caller, first.id);

    const refused = caller.maze.createConcept({ ...settings, name: "Second" });
    await expect(rejection(refused)).resolves.toEqual({
      code: "CONFLICT",
      message: "errors.conceptExists",
    });
    // Names the concept, for the popup.
    await expect(refused.catch((e: Error) => e.cause)).resolves.toMatchObject({
      issue: { key: "errors.conceptExists", params: { name: "First" } },
    });
    expect(await rowOf(first.id)).toBeDefined();

    const second = await caller.maze.createConcept({
      ...settings,
      name: "Second",
      replace: true,
    });
    expect(await rowOf(first.id)).toBeUndefined();
    expect((await rowOf(second.id))?.concept).toBe(true);
  });

  it("replaces an empty concept without asking", async () => {
    const caller = createCaller(await signedIn());
    const first = await caller.maze.createConcept(settings);

    const second = await caller.maze.createConcept({
      ...settings,
      name: "Second",
    });
    expect(await rowOf(first.id)).toBeUndefined();
    expect((await rowOf(second.id))?.concept).toBe(true);
  });

  it("keeps one concept when two replacements race", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    await caller.maze.createConcept(settings);

    const results = await Promise.allSettled([
      caller.maze.createConcept({ ...settings, replace: true }),
      caller.maze.createConcept({ ...settings, replace: true }),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const concepts = await db
      .select()
      .from(maze)
      .where(
        and(eq(maze.authorId, ctx.session!.user.id), eq(maze.concept, true)),
      );
    expect(concepts).toHaveLength(1);
  });

  it("rejects a cell count that is not a preset", async () => {
    const caller = createCaller(await signedIn());
    await expect(
      rejection(caller.maze.createConcept({ ...settings, cellCount: 37 })),
    ).resolves.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an anonymous caller with a message key", async () => {
    const caller = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    await expect(
      rejection(caller.maze.createConcept(settings)),
    ).resolves.toEqual({ code: "UNAUTHORIZED", message: "errors.notSignedIn" });
  });
});

describe("maze.saveDraft", () => {
  it("stores the draft and leaves derived columns null while invalid", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createConcept(settings);

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
    const created = await caller.maze.createConcept({
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
    const created = await owner.maze.createConcept(settings);
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
    const created = await caller.maze.createConcept(settings);
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
    const created = await caller.maze.createConcept(settings);
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

  it("refuses a saved labyrinth: only a concept is autosaved", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    const saved = await savedRow(ctx.session!.user.id);

    await expect(
      rejection(
        caller.maze.saveDraft({
          id: saved.id,
          data: { ...emptyDraft(), cells: [{ x: 0, y: 0 }] },
          expectedVersion: 0,
        }),
      ),
    ).resolves.toEqual({ code: "FORBIDDEN", message: "errors.mazeIsSaved" });
    expect((await rowOf(saved.id))?.data).toEqual(emptyDraft());
  });
});

describe("maze.list", () => {
  it("returns only the caller's mazes, the concept first, then newest first", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    const concept = await caller.maze.createConcept({
      ...settings,
      name: "Concept",
    });
    const first = await savedRow(ctx.session!.user.id, { name: "One" });
    const second = await savedRow(ctx.session!.user.id, { name: "Two" });

    const stranger = createCaller(await signedIn());
    await stranger.maze.createConcept({ ...settings, name: "Theirs" });

    const mine = await caller.maze.list();
    expect(mine.map((m) => m.id)).toEqual([concept.id, second.id, first.id]);
    expect(mine.every((m) => m.name !== "Theirs")).toBe(true);
  });

  it("returns each of the caller's own drawings as a parsed preview, never the raw data column", async () => {
    const caller = createCaller(await signedIn());
    await caller.maze.createConcept(settings);
    const [summary] = await caller.maze.list();
    expect(summary).toBeDefined();
    expect(summary).not.toHaveProperty("data");
    expect(summary!.preview).toEqual(emptyDraft());
  });
});

describe("maze.get", () => {
  it("returns the caller's own maze", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createConcept(settings);
    const fetched = await caller.maze.get({ id: created.id });
    expect(fetched.id).toBe(created.id);
    expect(fetched.data).toEqual(emptyDraft());
  });

  it("projects only what the editor and the read-only view need — no authorId or derived metrics", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createConcept(settings);
    const fetched = await caller.maze.get({ id: created.id });
    expect(Object.keys(fetched).sort()).toEqual(
      [
        "cellCount",
        "concept",
        "data",
        "gateCount",
        "id",
        "name",
        "sourceId",
        "version",
      ].sort(),
    );
    expect(fetched).not.toHaveProperty("authorId");
    expect(fetched).not.toHaveProperty("contentHash");
    expect(fetched).not.toHaveProperty("optimalMoves");
  });

  it("refuses someone else's maze, indistinguishably from a missing one", async () => {
    const owner = createCaller(await signedIn());
    const created = await owner.maze.createConcept(settings);
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
    const created = await caller.maze.createConcept(settings);

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
    const created = await owner.maze.createConcept(settings);
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
});

/** A match in `drawing`: `host` made it at `settings`' size, a guest joined. */
async function drawingMatch() {
  const hostCtx = await signedIn();
  const host = createCaller(hostCtx);
  const created = await host.match.create({
    cellCount: settings.cellCount,
    gateCount: settings.gateCount,
  });
  await createCaller(await signedIn()).match.join({ matchId: created.id });
  return { host, hostId: hostCtx.session!.user.id, matchId: created.id };
}

describe("maze.conceptForMatch", () => {
  it("creates an empty concept at the match's settings when there is none", async () => {
    const { host, hostId, matchId } = await drawingMatch();

    const { id } = await host.maze.conceptForMatch({ matchId, name: "New" });

    const [row] = await db.select().from(maze).where(eq(maze.id, id));
    expect(row?.authorId).toBe(hostId);
    expect(row?.concept).toBe(true);
    expect(row?.name).toBe("New");
    expect(row?.cellCount).toBe(settings.cellCount);
    expect(row?.gateCount).toBe(settings.gateCount);
    expect(row?.data).toEqual(emptyDraft());
  });

  it("reuses the caller's own empty concept at the same settings", async () => {
    const { host, matchId } = await drawingMatch();

    const first = await host.maze.conceptForMatch({ matchId, name: "New" });
    const second = await host.maze.conceptForMatch({ matchId, name: "New" });

    expect(second.id).toBe(first.id);
    const mine = await host.maze.list();
    expect(mine.map((m) => m.id)).toEqual([first.id]);
  });

  it("asks before replacing a concept that has squares", async () => {
    const { host, matchId } = await drawingMatch();
    const kept = await host.maze.createConcept(settings);
    await paint(host, kept.id);

    await expect(
      rejection(host.maze.conceptForMatch({ matchId, name: "New" })),
    ).resolves.toEqual({ code: "CONFLICT", message: "errors.conceptExists" });
    expect(await rowOf(kept.id)).toBeDefined();

    const { id } = await host.maze.conceptForMatch({
      matchId,
      name: "New",
      replace: true,
    });
    expect(id).not.toBe(kept.id);
    expect(await rowOf(kept.id)).toBeUndefined();
  });

  it("replaces an empty concept at other settings without asking", async () => {
    for (const values of [
      { ...settings, cellCount: 64 as const },
      { ...settings, gateCount: settings.gateCount + 1 },
    ]) {
      const { host, matchId } = await drawingMatch();
      const kept = await host.maze.createConcept(values);

      const { id } = await host.maze.conceptForMatch({ matchId, name: "New" });
      expect(id).not.toBe(kept.id);
      expect(await rowOf(kept.id)).toBeUndefined();
    }
  });

  it("never touches someone else's concept", async () => {
    const { host, matchId } = await drawingMatch();
    const stranger = createCaller(await signedIn());
    const theirs = await stranger.maze.createConcept(settings);

    const { id } = await host.maze.conceptForMatch({ matchId, name: "New" });

    expect(id).not.toBe(theirs.id);
    expect(await rowOf(theirs.id)).toBeDefined();
  });

  it("refuses a caller who is not in the match, indistinguishably from a missing one", async () => {
    const { matchId } = await drawingMatch();
    const strangerCtx = await signedIn();
    const stranger = createCaller(strangerCtx);

    const notMine = await rejection(
      stranger.maze.conceptForMatch({ matchId, name: "New" }),
    );
    const missing = await rejection(
      stranger.maze.conceptForMatch({
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
      rejection(
        host.maze.conceptForMatch({ matchId: created.id, name: "New" }),
      ),
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
  it("deletes the caller's own empty concept", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createConcept(settings);

    await caller.maze.discardIfEmpty({ id: created.id });

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row).toBeUndefined();
  });

  it("keeps a draft that has squares", async () => {
    const caller = createCaller(await signedIn());
    const created = await caller.maze.createConcept(settings);
    await caller.maze.saveDraft({
      id: created.id,
      data: { ...emptyDraft(), cells: [{ x: 0, y: 0 }] },
      expectedVersion: 0,
    });

    await caller.maze.discardIfEmpty({ id: created.id });

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row).toBeDefined();
  });

  it("keeps a saved labyrinth, even an empty one", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    const saved = await savedRow(ctx.session!.user.id);

    await caller.maze.discardIfEmpty({ id: saved.id });

    expect(await rowOf(saved.id)).toBeDefined();
  });

  it("keeps someone else's empty draft, and is a quiet no-op for them and for a missing id", async () => {
    const owner = createCaller(await signedIn());
    const created = await owner.maze.createConcept(settings);
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

  async function fill(userId: string, count: number) {
    for (let i = 0; i < count; i++) {
      await savedRow(userId, { name: `Maze ${i}` });
    }
  }

  it("refuses to save one more than the limit, and keeps the concept", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    await fill(ctx.session!.user.id, MAZE_LIMIT);

    const concept = await caller.maze.createConcept({ name: "C", ...solvable });
    const { version } = await caller.maze.saveDraft({
      id: concept.id,
      data: solvableDraft(),
      expectedVersion: 0,
    });
    await expect(
      rejection(
        caller.maze.saveConcept({ id: concept.id, expectedVersion: version }),
      ),
    ).resolves.toEqual(limitReached);
    expect((await rowOf(concept.id))?.concept).toBe(true);
  });

  it("counts saved labyrinths but not the concept", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    await fill(ctx.session!.user.id, MAZE_LIMIT - 1);
    await caller.maze.createConcept(settings);

    await expect(savedReady(caller)).resolves.toHaveProperty("id");
    await expect(rejection(savedReady(caller))).resolves.toEqual(limitReached);
  });

  it("lets a concept be drawn at the limit", async () => {
    const { host, hostId, matchId } = await drawingMatch();
    await fill(hostId, MAZE_LIMIT);
    await expect(
      host.maze.conceptForMatch({ matchId, name: "New" }),
    ).resolves.toHaveProperty("id");
    await expect(
      host.maze.createConcept({ ...settings, replace: true }),
    ).resolves.toHaveProperty("id");
  });
});

describe("maze.saveConcept", () => {
  it("turns a valid new concept into a ready labyrinth", async () => {
    const caller = createCaller(await signedIn());
    const { id } = await savedReady(caller, "Mine");

    const row = await rowOf(id);
    expect(row?.concept).toBe(false);
    expect(row?.name).toBe("Mine");
    expect(row?.contentHash).not.toBeNull();
    const listed = (await caller.maze.list()).find((m) => m.id === id);
    expect(listed?.state).toBe("ready");
  });

  it("refuses a concept that does not validate", async () => {
    const caller = createCaller(await signedIn());
    const concept = await caller.maze.createConcept(settings);
    const { version } = await caller.maze.saveDraft({
      id: concept.id,
      data: { ...emptyDraft(), cells: [{ x: 0, y: 0 }] },
      expectedVersion: 0,
    });

    await expect(
      rejection(
        caller.maze.saveConcept({ id: concept.id, expectedVersion: version }),
      ),
    ).resolves.toEqual({ code: "BAD_REQUEST", message: "errors.mazeInvalid" });
    expect((await rowOf(concept.id))?.concept).toBe(true);
  });

  it("refuses a stale version, so what is saved is what the editor showed", async () => {
    const caller = createCaller(await signedIn());
    const concept = await caller.maze.createConcept({ name: "C", ...solvable });
    await caller.maze.saveDraft({
      id: concept.id,
      data: solvableDraft(),
      expectedVersion: 0,
    });

    await expect(
      rejection(
        caller.maze.saveConcept({ id: concept.id, expectedVersion: 0 }),
      ),
    ).resolves.toEqual({
      code: "CONFLICT",
      message: "errors.draftChangedElsewhere",
    });
  });

  it("refuses a saved labyrinth and someone else's concept alike", async () => {
    const owner = createCaller(await signedIn());
    const saved = await savedReady(owner);
    const theirs = await owner.maze.createConcept(settings);
    const stranger = createCaller(await signedIn());

    for (const [caller, id] of [
      [owner, saved.id],
      [stranger, theirs.id],
    ] as const) {
      await expect(
        rejection(caller.maze.saveConcept({ id, expectedVersion: 0 })),
      ).resolves.toEqual({ code: "FORBIDDEN", message: "errors.notYourMaze" });
    }
  });
});

describe("maze.editAsConcept", () => {
  it("opens a ready labyrinth as a concept that saves back into it", async () => {
    const caller = createCaller(await signedIn());
    const saved = await savedReady(caller, "Original");
    const before = await rowOf(saved.id);

    const concept = await caller.maze.editAsConcept({ id: saved.id });
    const opened = await caller.maze.get({ id: concept.id });
    expect(opened).toMatchObject({
      concept: true,
      sourceId: saved.id,
      name: "Original",
      data: before?.data,
    });

    // Changed, but not saved yet: the library still has the original.
    const moved = { ...solvableDraft(), treasure: { x: 0, y: 5 } };
    const { version } = await caller.maze.saveDraft({
      id: concept.id,
      data: moved,
      expectedVersion: opened.version,
    });
    expect((await rowOf(saved.id))?.data).toEqual(before?.data);

    const result = await caller.maze.saveConcept({
      id: concept.id,
      expectedVersion: version,
    });
    expect(result.id).toBe(saved.id);
    expect((await rowOf(saved.id))?.data).toEqual(moved);
    expect(await rowOf(concept.id)).toBeUndefined();
    expect((await caller.maze.list()).map((m) => m.id)).toEqual([saved.id]);
  });

  it("returns the concept already editing that labyrinth without asking", async () => {
    const caller = createCaller(await signedIn());
    const { id } = await savedReady(caller);

    const first = await caller.maze.editAsConcept({ id });
    await paint(caller, first.id);
    const again = await caller.maze.editAsConcept({ id });
    expect(again.id).toBe(first.id);
  });

  it("asks before replacing a different concept", async () => {
    const caller = createCaller(await signedIn());
    const saved = await savedReady(caller);
    const other = await caller.maze.createConcept(settings);
    await paint(caller, other.id);

    await expect(
      rejection(caller.maze.editAsConcept({ id: saved.id })),
    ).resolves.toEqual({ code: "CONFLICT", message: "errors.conceptExists" });
    expect(await rowOf(other.id)).toBeDefined();

    await caller.maze.editAsConcept({ id: saved.id, replace: true });
    expect(await rowOf(other.id)).toBeUndefined();
  });

  it("refuses a concept, a deleted labyrinth and someone else's", async () => {
    const owner = createCaller(await signedIn());
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    const theirs = await savedReady(owner);
    const deleted = await savedRow(ctx.session!.user.id);
    await caller.maze.remove({ id: deleted.id });
    const concept = await caller.maze.createConcept(settings);

    for (const id of [theirs.id, deleted.id, concept.id]) {
      await expect(
        rejection(caller.maze.editAsConcept({ id })),
      ).resolves.toEqual({ code: "FORBIDDEN", message: "errors.notYourMaze" });
    }
  });

  it("saves as a new labyrinth when the original was deleted in the meantime", async () => {
    const caller = createCaller(await signedIn());
    const saved = await savedReady(caller, "Original");
    const concept = await caller.maze.editAsConcept({ id: saved.id });
    const opened = await caller.maze.get({ id: concept.id });
    await caller.maze.remove({ id: saved.id });

    const result = await caller.maze.saveConcept({
      id: concept.id,
      expectedVersion: opened.version,
    });
    expect(result.id).toBe(concept.id);
    expect((await rowOf(concept.id))?.concept).toBe(false);
  });
});

describe("maze.list states", () => {
  it("labels each labyrinth concept, draft or ready", async () => {
    const ctx = await signedIn();
    const caller = createCaller(ctx);
    const userId = ctx.session!.user.id;
    const draft = await savedRow(userId, { name: "D" });
    const ready = await savedReady(caller, "R");
    const concept = await caller.maze.createConcept({ ...settings, name: "C" });

    const byId = new Map((await caller.maze.list()).map((m) => [m.id, m]));
    expect(byId.get(concept.id)?.state).toBe("concept");
    expect(byId.get(draft.id)?.state).toBe("draft");
    expect(byId.get(ready.id)?.state).toBe("ready");
    expect(byId.get(ready.id)).not.toHaveProperty("contentHash");
  });
});
