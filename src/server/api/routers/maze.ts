import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  CELL_COUNT_PRESETS,
  INCOMPLETE_DRAFT_KEY,
  MAX_GATES,
  draftMazeSchema,
  draftToMaze,
  emptyDraft,
  validateMaze,
} from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { maze } from "~/server/db/schema";
import { notYours, participantRows } from "~/server/match/access";

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
  gateCount: z.number().int().min(0).max(MAX_GATES),
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

/** The ownership filter every read and write shares. */
function ownedBy(id: string, userId: string) {
  return and(eq(maze.id, id), eq(maze.authorId, userId));
}

/** A draft with no painted squares: nothing in it is worth keeping. */
const isEmptyDraft = and(
  eq(maze.status, "draft"),
  sql`jsonb_array_length(${maze.data} -> 'cells') = 0`,
);

export const mazeRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) =>
    ctx.db
      .select({
        id: maze.id,
        name: maze.name,
        cellCount: maze.cellCount,
        gateCount: maze.gateCount,
        status: maze.status,
        updatedAt: maze.updatedAt,
      })
      .from(maze)
      .where(eq(maze.authorId, ctx.session.user.id))
      .orderBy(desc(maze.updatedAt)),
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
          data: maze.data,
        })
        .from(maze)
        .where(ownedBy(input.id, ctx.session.user.id));
      const row = assertOwned(found);
      return { ...row, data: draftMazeSchema.parse(row.data) };
    }),

  createDraft: protectedProcedure
    .input(settingsInput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(maze)
        .values({
          authorId: ctx.session.user.id,
          name: input.name,
          cellCount: input.cellCount,
          gateCount: input.gateCount,
          data: emptyDraft(),
        })
        .returning({ id: maze.id });

      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "errors.unknown",
        });
      }
      return row;
    }),

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

      const [created] = await ctx.db
        .insert(maze)
        .values({
          authorId: userId,
          name: input.name,
          cellCount: row.cellCount,
          gateCount: row.gateCount,
          data: emptyDraft(),
        })
        .returning({ id: maze.id });
      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "errors.unknown",
        });
      }
      return created;
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

  saveDraft: protectedProcedure
    .input(z.object({ id: z.string(), data: draftMazeSchema }))
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

      const updated = await ctx.db
        .update(maze)
        .set({
          data: input.data,
          contentHash: validation?.ok ? validation.contentHash : null,
          optimalMoves: validation?.ok ? validation.optimalMoves : null,
        })
        .where(ownedBy(input.id, ctx.session.user.id))
        .returning({ id: maze.id });
      assertOwned(updated[0]);

      if (validation?.ok) return { valid: true as const, issues: [] };
      return {
        valid: false as const,
        issues: validation?.issues ?? [{ key: INCOMPLETE_DRAFT_KEY }],
      };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
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

      const deleted = await ctx.db
        .delete(maze)
        .where(ownedBy(input.id, ctx.session.user.id))
        .returning({ id: maze.id });
      assertOwned(deleted[0]);
      return { id: input.id };
    }),
});
