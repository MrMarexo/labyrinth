import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  CELL_COUNT_PRESETS,
  MAX_GATES,
  draftMazeSchema,
  draftToMaze,
  emptyDraft,
  validateMaze,
} from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { maze } from "~/server/db/schema";

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
        .select()
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

      await ctx.db
        .update(maze)
        .set({
          data: input.data,
          contentHash: validation?.ok ? validation.contentHash : null,
          optimalMoves: validation?.ok ? validation.optimalMoves : null,
        })
        .where(eq(maze.id, input.id));

      if (validation?.ok) return { valid: true as const, issues: [] };
      return {
        valid: false as const,
        issues: validation?.issues ?? [
          { key: "maze.validate.incomplete" as const },
        ],
      };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [found] = await ctx.db
        .select({ id: maze.id })
        .from(maze)
        .where(ownedBy(input.id, ctx.session.user.id));
      assertOwned(found);
      await ctx.db.delete(maze).where(eq(maze.id, input.id));
      return { id: input.id };
    }),
});
