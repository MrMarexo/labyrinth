import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { emptyDraft } from "~/maze";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { maze } from "~/server/db/schema";

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
      caller.maze.createDraft({ ...settings, cellCount: 37 }),
    ).rejects.toThrow();
  });

  it("rejects an anonymous caller with a message key", async () => {
    const caller = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    await expect(caller.maze.createDraft(settings)).rejects.toThrow(
      "errors.notSignedIn",
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
    });

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);

    const [row] = await db.select().from(maze).where(eq(maze.id, created.id));
    expect(row?.contentHash).toBeNull();
    expect(row?.optimalMoves).toBeNull();
  });

  it("refuses to touch a maze belonging to someone else", async () => {
    const owner = createCaller(await signedIn());
    const created = await owner.maze.createDraft(settings);

    const stranger = createCaller(await signedIn());
    await expect(
      stranger.maze.saveDraft({ id: created.id, data: emptyDraft() }),
    ).rejects.toThrow("errors.notYourMaze");
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

  it("does not return the maze data — the list only needs summaries", async () => {
    const caller = createCaller(await signedIn());
    await caller.maze.createDraft(settings);
    const [summary] = await caller.maze.list();
    expect(summary).toBeDefined();
    expect(summary).not.toHaveProperty("data");
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

  it("refuses someone else's maze", async () => {
    const owner = createCaller(await signedIn());
    const created = await owner.maze.createDraft(settings);
    const stranger = createCaller(await signedIn());
    await expect(stranger.maze.get({ id: created.id })).rejects.toThrow(
      "errors.notYourMaze",
    );
  });
});
