import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
} from "drizzle-orm";
import { z } from "zod";

import {
  deadlineFor,
  MATCH_ACCESS,
  type MatchAccess,
  makeCode,
  matchChannel,
  runChannel,
} from "~/match";
import {
  CELL_COUNT_PRESETS,
  MAX_GATES,
  draftMazeSchema,
  validateMaze,
} from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  match,
  matchPlayer,
  matchRequest,
  maze,
  user,
} from "~/server/db/schema";
import {
  notYours,
  participantRows,
  type DbClient,
} from "~/server/match/access";
import { seatOpponent } from "~/server/match/seat";
import { situationFor } from "~/server/match/situation";
import { closeIfExpired } from "~/server/match/sweep";
import {
  publishLobbyChanged,
  publishMatchChanged,
} from "~/server/realtime/events";

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

const createInput = settingsInput.extend({
  access: z.enum(MATCH_ACCESS).default("open"),
});

export type LobbyItem = {
  id: string;
  creatorName: string;
  cellCount: number;
  gateCount: number;
  access: MatchAccess;
  createdAt: Date;
  deadlineAt: Date;
  request: "none" | "pending" | "declined";
};

/**
 * Waiting, unexpired matches with the caller's own request state. Never
 * selects `code` or any maze column: the lobby is not a way into a match.
 */
async function waitingMatches(db: DbClient, callerId: string, now: Date) {
  const rows = await db
    .select({
      id: match.id,
      creatorId: match.createdById,
      creatorName: user.name,
      cellCount: match.cellCount,
      gateCount: match.gateCount,
      access: match.access,
      createdAt: match.createdAt,
      deadlineAt: match.deadlineAt,
      requested: matchRequest.userId,
      declinedAt: matchRequest.declinedAt,
    })
    .from(match)
    .innerJoin(user, eq(user.id, match.createdById))
    .leftJoin(
      matchRequest,
      and(
        eq(matchRequest.matchId, match.id),
        eq(matchRequest.userId, callerId),
      ),
    )
    .where(
      and(eq(match.status, "awaiting_opponent"), gt(match.deadlineAt, now)),
    )
    .orderBy(desc(match.createdAt));

  return rows.map(({ requested, declinedAt, creatorId, ...row }) => ({
    creatorId,
    item: {
      ...row,
      request:
        requested === null
          ? ("none" as const)
          : declinedAt
            ? ("declined" as const)
            : ("pending" as const),
    } satisfies LobbyItem,
  }));
}

/**
 * Every maze of this author that the opponent has already faced in some
 * other match. Rule 4 of §6: reuse is what makes the library worth having,
 * but not against someone who has already walked the maze — which requires
 * that match to have actually reached `running`.
 *
 * That has to be read off the opponent's own `matchPlayer.submittedAt`, not
 * off `match.status`: in Phase 3 nobody can move or finish a run, so every
 * `running` match's deadline (row 4 of §9.1) can only ever expire into
 * `abandoned` — there is no other outcome `resolveExpiry` can reach while
 * `finishedAt` stays permanently null. A `status`-based filter would
 * therefore un-face every maze on a one-day timer, the moment the sweep
 * closes the very match that exposed it. `submittedAt` has no such decay:
 * it is written once, in the same statement as `mazeId`, and nothing ever
 * clears it — so it is still true a day, a week, or a year after the match
 * that set it has moved on to any status at all. A match still stuck in
 * `drawing` (including one the sweep later abandons there) never got this
 * far, so it correctly does not count.
 */
async function mazesFacedBy(
  db: DbClient,
  opponentId: string | null,
  exceptMatchId: string,
): Promise<string[]> {
  if (!opponentId) return [];

  const theirMatches = await db
    .select({ matchId: matchPlayer.matchId })
    .from(matchPlayer)
    .where(
      and(
        eq(matchPlayer.userId, opponentId),
        isNotNull(matchPlayer.submittedAt),
      ),
    );

  const ids = theirMatches
    .map((m) => m.matchId)
    .filter((id) => id !== exceptMatchId);
  if (ids.length === 0) return [];

  const faced = await db
    .select({ mazeId: matchPlayer.mazeId })
    .from(matchPlayer)
    .where(
      and(
        inArray(matchPlayer.matchId, ids),
        ne(matchPlayer.userId, opponentId),
      ),
    );

  return faced.map((f) => f.mazeId).filter((id): id is string => id !== null);
}

export const matchRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      const [waiting] = await ctx.db
        .select({ id: match.id, deadlineAt: match.deadlineAt })
        .from(match)
        .where(
          and(
            eq(match.createdById, ctx.session.user.id),
            eq(match.status, "awaiting_opponent"),
          ),
        );
      if (waiting) {
        if (waiting.deadlineAt.getTime() > now.getTime()) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.alreadyWaiting",
          });
        }
        // Past its deadline, so it no longer counts; close it here rather
        // than make the creator wait for the sweep. Another request may have
        // closed it first, which `closeIfExpired` tolerates.
        await closeIfExpired(ctx.db, waiting.id, now);
      }

      // The unique index is the real guard against a collision; these
      // attempts just make hitting it vanishingly unlikely before the
      // database has to say so.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = makeCode((max) => Math.floor(Math.random() * max));
        try {
          const created = await ctx.db.transaction(async (tx) => {
            const [row] = await tx
              .insert(match)
              .values({
                code,
                cellCount: input.cellCount,
                gateCount: input.gateCount,
                access: input.access,
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
          await publishLobbyChanged();
          return created;
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          // Two concurrent creates both passed the check above; the partial
          // unique index lets only one through.
          if (message.includes("match_one_waiting_per_creator")) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "errors.alreadyWaiting",
            });
          }
          if (!message.includes("match_code")) throw error;
        }
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "errors.unknown",
      });
    }),

  join: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      const joined = await ctx.db.transaction(async (tx) => {
        // Locked, so a join racing `cancel` either waits for the delete and
        // then finds nothing, or seats its player before the cancel looks.
        const [row] = await tx
          .select()
          .from(match)
          .where(eq(match.id, input.matchId))
          .for("update");
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "errors.matchNotFound",
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

        if (row.access === "locked") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchLocked",
          });
        }

        await seatOpponent(tx, row, players, ctx.session.user.id, now);

        return { id: row.id };
      });

      await publishMatchChanged(joined.id);
      await publishLobbyChanged();
      return joined;
    }),

  lobby: protectedProcedure.query(async ({ ctx }) => {
    const rows = await waitingMatches(
      ctx.db,
      ctx.session.user.id,
      new Date(),
    );
    return {
      you: ctx.session.user.id,
      matches: rows
        .filter((r) => r.creatorId !== ctx.session.user.id)
        .map((r) => r.item),
    };
  }),

  preview: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await waitingMatches(
        ctx.db,
        ctx.session.user.id,
        new Date(),
      );
      const found = rows.find((r) => r.item.id === input.matchId);
      if (!found) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "errors.matchNotFound",
        });
      }
      return {
        ...found.item,
        isYours: found.creatorId === ctx.session.user.id,
      };
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
            .where(eq(user.id, them.userId))
        : [];

      return {
        id: row.id,
        code: row.code,
        status: row.status,
        access: row.access,
        isCreator: row.createdById === ctx.session.user.id,
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
        // Names only; the server decides who may join (canSubscribe).
        channels: {
          match: matchChannel(row.id),
          yourRun: runChannel(row.id, you.userId),
        },
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

  eligibleMazes: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await participantRows(
        ctx.db,
        input.matchId,
        ctx.session.user.id,
      );
      if (!found) notYours();
      const { row, players } = found;

      const opponentId =
        players.find((p) => p.userId !== ctx.session.user.id)?.userId ?? null;
      const faced = await mazesFacedBy(ctx.db, opponentId, row.id);

      const conditions = [
        eq(maze.authorId, ctx.session.user.id),
        eq(maze.cellCount, row.cellCount),
        eq(maze.gateCount, row.gateCount),
        // `contentHash` is only ever set by `saveDraft` once the maze
        // validates at these exact settings — a half-drawn draft has none,
        // so this is exactly the predicate that keeps `submitMaze` from
        // rejecting a choice the picker just offered as valid.
        isNotNull(maze.contentHash),
        isNull(maze.deletedAt),
      ];
      if (faced.length > 0) conditions.push(notInArray(maze.id, faced));

      // `data` is for the picker's previews. Author-facing: the first
      // condition limits this to the caller's own mazes, never the
      // opponent's (invariant 1).
      const rows = await ctx.db
        .select({
          id: maze.id,
          name: maze.name,
          updatedAt: maze.updatedAt,
          data: maze.data,
        })
        .from(maze)
        .where(and(...conditions))
        .orderBy(desc(maze.updatedAt));
      return rows.map((row) => ({
        ...row,
        data: draftMazeSchema.parse(row.data),
      }));
    }),

  /**
   * Deletes a match nobody has joined yet (spec §9). The players cascade,
   * and no maze can have been submitted to it. Anything past
   * `awaiting_opponent` is refused: the opponent has a stake by then.
   */
  cancel: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        // Locked like `join`, which locks the same row first, so the status
        // read here is the one the delete acts on.
        const found = await participantRows(
          tx,
          input.matchId,
          ctx.session.user.id,
          { lock: true },
        );
        if (!found) notYours();
        if (found.row.status !== "awaiting_opponent") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchNotCancellable",
          });
        }
        await tx.delete(match).where(eq(match.id, found.row.id));
      });

      await publishMatchChanged(input.matchId);
      return { id: input.matchId };
    }),

  submitMaze: protectedProcedure
    .input(z.object({ matchId: z.string(), mazeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      const submitted = await ctx.db.transaction(async (tx) => {
        const found = await participantRows(
          tx,
          input.matchId,
          ctx.session.user.id,
        );
        if (!found) notYours();
        const { row, players } = found;

        const you = players.find((p) => p.userId === ctx.session.user.id)!;
        const them = players.find((p) => p.userId !== ctx.session.user.id);

        if (row.status !== "drawing") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchNotDrawing",
          });
        }
        if (now.getTime() >= row.deadlineAt.getTime()) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchExpired",
          });
        }
        if (you.submittedAt !== null) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.alreadySubmitted",
          });
        }

        const [mazeRow] = await tx
          .select()
          .from(maze)
          .where(
            and(
              eq(maze.id, input.mazeId),
              eq(maze.authorId, ctx.session.user.id),
              isNull(maze.deletedAt),
            ),
          )
          // Locked so a concurrent `maze.remove` waits for this submit and
          // then sees the maze as used, rather than deleting it under us.
          .for("update");
        // Not yours and not there are the same answer, exactly as the maze
        // router already treats them.
        if (!mazeRow) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "errors.notYourMaze",
          });
        }

        if (
          mazeRow.cellCount !== row.cellCount ||
          mazeRow.gateCount !== row.gateCount
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "errors.mazeSettingsMismatch",
          });
        }

        const faced = await mazesFacedBy(tx, them?.userId ?? null, row.id);
        if (faced.includes(mazeRow.id)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.mazeAlreadyFaced",
          });
        }

        // The server's verdict is the only one that counts (§4). A maze
        // already marked submitted was validated on its way in, but
        // re-running it costs one BFS and removes the assumption.
        const validation = validateMaze(mazeRow.data, {
          cellCount: row.cellCount,
          gateCount: row.gateCount,
        });
        if (!validation.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "errors.mazeInvalid",
          });
        }

        await tx
          .update(maze)
          .set({
            status: "submitted",
            contentHash: validation.contentHash,
            optimalMoves: validation.optimalMoves,
          })
          .where(eq(maze.id, mazeRow.id));

        await tx
          .update(matchPlayer)
          .set({ mazeId: mazeRow.id, submittedAt: now })
          .where(
            and(
              eq(matchPlayer.matchId, row.id),
              eq(matchPlayer.userId, ctx.session.user.id),
            ),
          );

        const seated = players.map((p) =>
          p.userId === ctx.session.user.id
            ? { ...p, mazeId: mazeRow.id, submittedAt: now }
            : p,
        );
        const bothIn =
          seated.length === 2 && seated.every((p) => p.submittedAt !== null);
        const status = bothIn ? ("running" as const) : row.status;
        const next = { ...row, status, lastActivityAt: now };

        await tx
          .update(match)
          .set({
            status,
            lastActivityAt: now,
            deadlineAt: deadlineFor(situationFor(next, seated))!,
          })
          .where(eq(match.id, row.id));

        return { status };
      });

      await publishMatchChanged(input.matchId);
      return submitted;
    }),
});
