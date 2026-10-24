import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  CELL_COUNT_PRESETS,
  MAX_GATE_COUNT,
  MAZE_LIMIT,
  draftMazeSchema,
  draftToMaze,
  emptyDraft,
  incompleteDraftIssues,
  mazeState,
  validateMaze,
} from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { maze, user } from "~/server/db/schema";
import {
  notYours,
  participantRows,
  type DbClient,
} from "~/server/match/access";

const settingsInput = z.object({
  name: z.string().trim().min(1).max(80),
  cellCount: z
    .number()
    .int()
    .refine(
      (n): n is (typeof CELL_COUNT_PRESETS)[number] =>
        (CELL_COUNT_PRESETS as readonly number[]).includes(n),
      { message: "maze.format.cellCountNotAPreset" },
    ),
  gateCount: z.number().int().min(0).max(MAX_GATE_COUNT),
});

/**
 * Narrows a possibly-missing row, throwing a keyed error. Each procedure runs
 * its own query filtered by author, so "not found" and "not yours" are the
 * same answer — which is also the right answer to give, since distinguishing
 * them would confirm that someone else's maze exists.
 */
function assertOwned<T>(row: T | undefined): T {
  if (!row) {
    throw new TRPCError({ code: "FORBIDDEN", message: "errors.notYourMaze" });
  }
  return row;
}

/**
 * The ownership filter every read and write shares. A deleted maze is no
 * longer the author's to open, edit or delete again, so it fails this too.
 */
function ownedBy(id: string, userId: string) {
  return and(
    eq(maze.id, id),
    eq(maze.authorId, userId),
    isNull(maze.deletedAt),
  );
}

/** A draft with no painted squares: nothing in it is worth keeping. */
const isEmptyDraft = and(
  eq(maze.status, "draft"),
  sql`jsonb_array_length(${maze.data} -> 'cells') = 0`,
);

/**
 * Inserts an empty draft unless the author already keeps `MAZE_LIMIT`
 * labyrinths. Their `user` row is locked first, so two tabs racing for the
 * last slot are serialised and the second one counts the first one's insert.
 */
async function createWithinLimit(
  db: DbClient,
  values: {
    authorId: string;
    name: string;
    cellCount: number;
    gateCount: number;
  },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, values.authorId))
      .for("update");
    const [kept] = await tx
      .select({ n: count() })
      .from(maze)
      .where(and(eq(maze.authorId, values.authorId), isNull(maze.deletedAt)));
    if ((kept?.n ?? 0) >= MAZE_LIMIT) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "errors.mazeLimitReached",
      });
    }

    const [row] = await tx
      .insert(maze)
      .values({ ...values, data: emptyDraft() })
      .returning({ id: maze.id });
    if (!row) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "errors.unknown",
      });
    }
    return row;
  });
}

export const mazeRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) =>
    ctx.db
      .select({
        id: maze.id,
        name: maze.name,
        cellCount: maze.cellCount,
        gateCount: maze.gateCount,
        status: maze.status,
        contentHash: maze.contentHash,
        updatedAt: maze.updatedAt,
        // The author's own mazes only (filtered below), so returning the
        // drawing for the list's previews is an author-facing read.
        data: maze.data,
      })
      .from(maze)
      .where(
        and(eq(maze.authorId, ctx.session.user.id), isNull(maze.deletedAt)),
      )
      .orderBy(desc(maze.updatedAt))
      .then((rows) =>
        rows.map(({ data, contentHash, ...row }) => {
          const parsed = draftMazeSchema.safeParse(data);
          return {
            ...row,
            state: mazeState({ status: row.status, contentHash }),
            preview: parsed.success ? parsed.data : null,
          };
        }),
      ),
  ),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [found] = await ctx.db
        .select({
          id: maze.id,
          name: maze.name,
          cellCount: maze.cellCount,
          gateCount: maze.gateCount,
          status: maze.status,
          version: maze.version,
          data: maze.data,
        })
        .from(maze)
        .where(ownedBy(input.id, ctx.session.user.id));
      const row = assertOwned(found);
      return { ...row, data: draftMazeSchema.parse(row.data) };
    }),

  createDraft: protectedProcedure
    .input(settingsInput)
    .mutation(({ ctx, input }) =>
      createWithinLimit(ctx.db, {
        authorId: ctx.session.user.id,
        name: input.name,
        cellCount: input.cellCount,
        gateCount: input.gateCount,
      }),
    ),

  /**
   * The lobby's "Draw a new one": an empty draft at this match's settings.
   * Reuses one of the caller's own empty drafts at those settings if there
   * is one, so a player who opens and leaves the editor a few times does not
   * collect a pile of blank labyrinths. Touches only the caller's own mazes.
   */
  draftForMatch: protectedProcedure
    .input(
      z.object({
        matchId: z.string(),
        name: settingsInput.shape.name,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const found = await participantRows(ctx.db, input.matchId, userId);
      if (!found) notYours();
      const { row } = found;
      if (row.status !== "drawing") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "errors.matchNotDrawing",
        });
      }

      const [reusable] = await ctx.db
        .select({ id: maze.id })
        .from(maze)
        .where(
          and(
            eq(maze.authorId, userId),
            eq(maze.cellCount, row.cellCount),
            eq(maze.gateCount, row.gateCount),
            isEmptyDraft,
          ),
        )
        .orderBy(desc(maze.updatedAt))
        .limit(1);
      if (reusable) return reusable;

      return createWithinLimit(ctx.db, {
        authorId: userId,
        name: input.name,
        cellCount: row.cellCount,
        gateCount: row.gateCount,
      });
    }),

  /**
   * Deletes the maze only if it is the caller's own draft with no painted
   * squares; anything else is left alone without an error, so the editor
   * can call it blindly on the way out.
   */
  discardIfEmpty: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(maze)
        .where(and(ownedBy(input.id, ctx.session.user.id), isEmptyDraft))
        .returning({ id: maze.id });
      return { discarded: deleted.length > 0 };
    }),

  /**
   * Writes the draft only over `expectedVersion`, the version the editor
   * last loaded or saved, and returns the new one. An editor working from a
   * stale copy — a second tab, a page the router cached — is refused with
   * `errors.draftChangedElsewhere` instead of silently dropping newer work.
   */
  saveDraft: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: draftMazeSchema,
        expectedVersion: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [found] = await ctx.db
        .select()
        .from(maze)
        .where(ownedBy(input.id, ctx.session.user.id));
      const row = assertOwned(found);

      if (row.status === "submitted") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "errors.mazeIsSubmitted",
        });
      }

      const complete = draftToMaze(input.data);
      const validation = complete
        ? validateMaze(complete, {
            cellCount: row.cellCount,
            gateCount: row.gateCount,
          })
        : null;

      // One conditional statement: still the caller's, still a draft (a
      // `submitMaze` since the read above is caught here too), and still at
      // the version this editor last saw.
      const [updated] = await ctx.db
        .update(maze)
        .set({
          data: input.data,
          contentHash: validation?.ok ? validation.contentHash : null,
          optimalMoves: validation?.ok ? validation.optimalMoves : null,
          version: sql`${maze.version} + 1`,
        })
        .where(
          and(
            ownedBy(input.id, ctx.session.user.id),
            eq(maze.status, "draft"),
            eq(maze.version, input.expectedVersion),
          ),
        )
        .returning({ version: maze.version });

      if (!updated) {
        const [found] = await ctx.db
          .select({ status: maze.status })
          .from(maze)
          .where(ownedBy(input.id, ctx.session.user.id));
        if (assertOwned(found).status === "submitted") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "errors.mazeIsSubmitted",
          });
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: "errors.draftChangedElsewhere",
        });
      }

      const { version } = updated;
      if (validation?.ok) return { valid: true as const, issues: [], version };
      return {
        valid: false as const,
        issues:
          validation?.issues ??
          incompleteDraftIssues(input.data, {
            cellCount: row.cellCount,
            gateCount: row.gateCount,
          }),
        version,
      };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const mine = ownedBy(input.id, ctx.session.user.id);
      // A draft goes for good. The status is part of the statement, not a
      // prior read: a `submitMaze` landing in between must not let a maze a
      // match now uses be deleted (the foreign key would only null the link).
      const deleted = await ctx.db
        .delete(maze)
        .where(and(mine, eq(maze.status, "draft")))
        .returning({ id: maze.id });
      if (deleted[0]) return { id: input.id };

      // A used maze is only hidden: matches that used it keep reading it
      // until their replay window closes, then the nightly purge removes it.
      const hidden = await ctx.db
        .update(maze)
        .set({ deletedAt: new Date() })
        .where(and(mine, eq(maze.status, "submitted")))
        .returning({ id: maze.id });
      assertOwned(hidden[0]);
      return { id: input.id };
    }),
});
