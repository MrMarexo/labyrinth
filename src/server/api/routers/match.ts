import { TRPCError } from "@trpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { deadlineFor, makeCode, matchCodeSchema } from "~/match";
import { CELL_COUNT_PRESETS, MAX_GATES } from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { type db } from "~/server/db";
import { match, matchPlayer, user } from "~/server/db/schema";
import {
  situationFor,
  type MatchRow,
  type PlayerRow,
} from "~/server/match/situation";

const settingsInput = z.object({
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

/** Every read of a match the caller must be part of. */
async function participantRows(tx: typeof db, matchId: string, userId: string) {
  const [row] = await tx.select().from(match).where(eq(match.id, matchId));
  if (!row) return null;
  const players = await tx
    .select()
    .from(matchPlayer)
    .where(eq(matchPlayer.matchId, matchId));
  if (!players.some((p) => p.userId === userId)) return null;
  return { row, players };
}

/**
 * A match the caller is not in and a match that does not exist get the same
 * answer, for the same reason `maze.get` does: distinguishing them would
 * confirm the match exists to someone with no business knowing.
 */
function notYours(): never {
  throw new TRPCError({ code: "FORBIDDEN", message: "errors.notYourMatch" });
}

export const matchRouter = createTRPCRouter({
  create: protectedProcedure
    .input(settingsInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      // The unique index is the real guard against a collision; these
      // attempts just make hitting it vanishingly unlikely before the
      // database has to say so.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = makeCode((max) => Math.floor(Math.random() * max));
        try {
          return await ctx.db.transaction(async (tx) => {
            const [row] = await tx
              .insert(match)
              .values({
                code,
                cellCount: input.cellCount,
                gateCount: input.gateCount,
                createdById: ctx.session.user.id,
                createdAt: now,
                lastActivityAt: now,
                // Row 1 of §9.1: nobody has joined, 24h from creation.
                deadlineAt: deadlineFor({
                  status: "awaiting_opponent",
                  createdAt: now,
                  bothJoinedAt: null,
                  unlockedAt: null,
                  lastActivityAt: now,
                  players: [],
                })!,
              })
              .returning({ id: match.id, code: match.code });

            await tx.insert(matchPlayer).values({
              matchId: row!.id,
              userId: ctx.session.user.id,
              joinedAt: now,
            });

            return { id: row!.id, code: row!.code };
          });
        } catch (error) {
          const isDuplicateCode =
            error instanceof Error && error.message.includes("match_code");
          if (!isDuplicateCode) throw error;
        }
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "errors.unknown",
      });
    }),

  join: protectedProcedure
    .input(z.object({ code: matchCodeSchema }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(match)
          .where(eq(match.code, input.code));
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "errors.matchCodeUnknown",
          });
        }

        const players = await tx
          .select()
          .from(matchPlayer)
          .where(eq(matchPlayer.matchId, row.id));

        if (players.some((p) => p.userId === ctx.session.user.id)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.alreadyInMatch",
          });
        }
        if (players.length >= 2) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchFull",
          });
        }
        if (
          row.status !== "awaiting_opponent" ||
          now.getTime() >= row.deadlineAt.getTime()
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchExpired",
          });
        }

        await tx.insert(matchPlayer).values({
          matchId: row.id,
          userId: ctx.session.user.id,
          joinedAt: now,
        });

        const seated: PlayerRow[] = [
          ...players,
          {
            matchId: row.id,
            userId: ctx.session.user.id,
            mazeId: null,
            joinedAt: now,
            submittedAt: null,
            forfeitedAt: null,
          },
        ];
        const next: MatchRow = {
          ...row,
          status: "drawing",
          lastActivityAt: now,
        };

        await tx
          .update(match)
          .set({
            status: "drawing",
            lastActivityAt: now,
            deadlineAt: deadlineFor(situationFor(next, seated))!,
          })
          .where(eq(match.id, row.id));

        return { id: row.id };
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await participantRows(
        ctx.db,
        input.id,
        ctx.session.user.id,
      );
      if (!found) notYours();
      const { row, players } = found;

      const you = players.find((p) => p.userId === ctx.session.user.id)!;
      const them = players.find((p) => p.userId !== ctx.session.user.id);

      const names = them
        ? await ctx.db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, [them.userId]))
        : [];

      return {
        id: row.id,
        code: row.code,
        status: row.status,
        cellCount: row.cellCount,
        gateCount: row.gateCount,
        deadlineAt: row.deadlineAt,
        winnerId: row.winnerId,
        endReason: row.endReason,
        you: {
          hasSubmitted: you.submittedAt !== null,
          hasForfeited: you.forfeitedAt !== null,
        },
        opponent: them
          ? {
              displayName: names[0]?.name ?? "",
              hasSubmitted: them.submittedAt !== null,
              hasForfeited: them.forfeitedAt !== null,
            }
          : null,
      };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const mine = await ctx.db
      .select({ matchId: matchPlayer.matchId })
      .from(matchPlayer)
      .where(eq(matchPlayer.userId, ctx.session.user.id));

    if (mine.length === 0) return [];

    return ctx.db
      .select({
        id: match.id,
        code: match.code,
        status: match.status,
        cellCount: match.cellCount,
        gateCount: match.gateCount,
        deadlineAt: match.deadlineAt,
        winnerId: match.winnerId,
        createdAt: match.createdAt,
      })
      .from(match)
      .where(
        inArray(
          match.id,
          mine.map((m) => m.matchId),
        ),
      )
      .orderBy(desc(match.createdAt));
  }),
});
