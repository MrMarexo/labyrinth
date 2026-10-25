import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  CELL_COUNT_PRESETS,
  MAX_GATE_COUNT,
  draftMazeSchema,
  draftToMaze,
  emptyDraft,
  incompleteDraftIssues,
  mazeState,
  validateMaze,
} from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { maze } from "~/server/db/schema";
import {
  notYours,
  participantRows,
  type DbClient,
} from "~/server/match/access";
import {
  conceptOf,
  dropConcept,
  lockAuthor,
  promoteConcept,
} from "~/server/maze/concept";

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

/** True once the author has agreed to lose the concept they have. */
const replaceInput = z.boolean().default(false);

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

/** A concept with no painted squares: nothing in it is worth keeping. */
const isEmptyConcept = and(
  eq(maze.concept, true),
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
        concept: maze.concept,
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
      // The concept first: it is what the author is working on.
      .orderBy(desc(maze.concept), desc(maze.updatedAt))
      .then((rows) =>
        rows.map(({ data, contentHash, ...row }) => {
          const parsed = draftMazeSchema.safeParse(data);
          return {
            ...row,
            state: mazeState({
              concept: row.concept,
              status: row.status,
              contentHash,
            }),
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
          concept: maze.concept,
          sourceId: maze.sourceId,
          version: maze.version,
          data: maze.data,
        })
        .from(maze)
        .where(ownedBy(input.id, ctx.session.user.id));
      const row = assertOwned(found);
      return { ...row, data: draftMazeSchema.parse(row.data) };
    }),

  /** A new, empty concept, in place of the one the author has. */
  createConcept: protectedProcedure
    .input(settingsInput.extend({ replace: replaceInput }))
    .mutation(({ ctx, input }) => {
      const authorId = ctx.session.user.id;
      return ctx.db.transaction(async (tx) => {
        await lockAuthor(tx, authorId);
        await dropConcept(tx, await conceptOf(tx, authorId), input.replace);
        return insertConcept(tx, {
          authorId,
          name: input.name,
          cellCount: input.cellCount,
          gateCount: input.gateCount,
        });
      });
    }),

  /**
   * The lobby's "Draw a new one": an empty concept at this match's
   * settings. An empty concept already at those settings is handed back
   * rather than replaced, so a player who opens and leaves the editor a few
   * times is never asked to give up nothing. Touches only the caller's own
   * mazes.
   */
  conceptForMatch: protectedProcedure
    .input(
      z.object({
        matchId: z.string(),
        name: settingsInput.shape.name,
        replace: replaceInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const authorId = ctx.session.user.id;
      const found = await participantRows(ctx.db, input.matchId, authorId);
      if (!found) notYours();
      const { row } = found;
      if (row.status !== "drawing") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "errors.matchNotDrawing",
        });
      }

      return ctx.db.transaction(async (tx) => {
        await lockAuthor(tx, authorId);
        const existing = await conceptOf(tx, authorId);
        if (
          existing?.cells === 0 &&
          existing.cellCount === row.cellCount &&
          existing.gateCount === row.gateCount
        ) {
          return { id: existing.id };
        }
        await dropConcept(tx, existing, input.replace);
        return insertConcept(tx, {
          authorId,
          name: input.name,
          cellCount: row.cellCount,
          gateCount: row.gateCount,
        });
      });
    }),

  /**
   * Opens a saved labyrinth for editing, as the author's concept: a ready
   * one is saved back into itself, a used one is never changed again, so
   * it is copied under `copyName` instead. The concept already editing this
   * labyrinth is handed back as it is.
   */
  editAsConcept: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        copyName: settingsInput.shape.name,
        replace: replaceInput,
      }),
    )
    .mutation(({ ctx, input }) => {
      const authorId = ctx.session.user.id;
      return ctx.db.transaction(async (tx) => {
        await lockAuthor(tx, authorId);
        const [found] = await tx
          .select()
          .from(maze)
          .where(and(ownedBy(input.id, authorId), eq(maze.concept, false)));
        const source = assertOwned(found);

        const existing = await conceptOf(tx, authorId);
        if (existing?.sourceId === source.id) return { id: existing.id };
        await dropConcept(tx, existing, input.replace);

        const used = source.status === "submitted";
        const [row] = await tx
          .insert(maze)
          .values({
            authorId,
            name: used ? input.copyName : source.name,
            cellCount: source.cellCount,
            gateCount: source.gateCount,
            data: source.data,
            contentHash: source.contentHash,
            optimalMoves: source.optimalMoves,
            concept: true,
            // Kept for a used one too, so its copy is recognised above;
            // `promoteConcept` never writes back into a used labyrinth.
            sourceId: source.id,
          })
          .returning({ id: maze.id });
        return { id: row!.id };
      });
    }),

  /**
   * Puts a valid concept in the author's library (see `promoteConcept`),
   * only at `expectedVersion`, so what is saved is what the editor showed.
   */
  saveConcept: protectedProcedure
    .input(
      z.object({ id: z.string(), expectedVersion: z.number().int().min(0) }),
    )
    .mutation(({ ctx, input }) => {
      const authorId = ctx.session.user.id;
      return ctx.db.transaction(async (tx) => {
        await lockAuthor(tx, authorId);
        const [found] = await tx
          .select()
          .from(maze)
          .where(and(ownedBy(input.id, authorId), eq(maze.concept, true)))
          .for("update");
        const concept = assertOwned(found);
        if (concept.version !== input.expectedVersion) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.draftChangedElsewhere",
          });
        }
        if (concept.contentHash === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "errors.mazeInvalid",
          });
        }
        const id = await promoteConcept(tx, concept, { checkLimit: true });
        return { id };
      });
    }),

  /**
   * Deletes the maze only if it is the caller's own concept with no painted
   * squares; anything else is left alone without an error, so the editor
   * can call it blindly on the way out.
   */
  discardIfEmpty: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(maze)
        .where(and(ownedBy(input.id, ctx.session.user.id), isEmptyConcept))
        .returning({ id: maze.id });
      return { discarded: deleted.length > 0 };
    }),

  /**
   * The editor's autosave, for a concept only: a saved labyrinth changes
   * only through `saveConcept`. Writes the draft only over `expectedVersion`, the version the editor
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
      if (!row.concept) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "errors.mazeIsSaved",
        });
      }

      const complete = draftToMaze(input.data);
      const validation = complete
        ? validateMaze(complete, {
            cellCount: row.cellCount,
            gateCount: row.gateCount,
          })
        : null;

      // One conditional statement: still the caller's, still a concept and
      // a draft (a `saveConcept` or `submitMaze` since the read above is
      // caught here too), and still at the version this editor last saw.
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
            eq(maze.concept, true),
            eq(maze.status, "draft"),
            eq(maze.version, input.expectedVersion),
          ),
        )
        .returning({ version: maze.version });

      if (!updated) {
        const [found] = await ctx.db
          .select({ status: maze.status, concept: maze.concept })
          .from(maze)
          .where(ownedBy(input.id, ctx.session.user.id));
        const now = assertOwned(found);
        if (now.status === "submitted") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "errors.mazeIsSubmitted",
          });
        }
        if (!now.concept) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "errors.mazeIsSaved",
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

async function insertConcept(
  tx: DbClient,
  values: {
    authorId: string;
    name: string;
    cellCount: number;
    gateCount: number;
  },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(maze)
    .values({ ...values, data: emptyDraft(), concept: true })
    .returning({ id: maze.id });
  if (!row) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "errors.unknown",
    });
  }
  return row;
}
