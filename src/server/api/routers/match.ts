import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  deadlineFor,
  holdsPlayer,
  isTerminal,
  MATCH_ACCESS,
  type MatchAccess,
  type MatchStatus,
  makeCode,
  matchChannel,
  runChannel,
} from "~/match";
import {
  CELL_COUNT_PRESETS,
  MAX_GATE_COUNT,
  draftMazeSchema,
  validateMaze,
} from "~/maze";
import {
  createTRPCRouter,
  memberProcedure,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { lockAuthor, promoteConcept } from "~/server/maze/concept";
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
import { assertFree } from "~/server/match/active";
import { seatOpponent } from "~/server/match/seat";
import { situationFor } from "~/server/match/situation";
import { closeIfExpired } from "~/server/match/sweep";
import {
  publishLobbyChanged,
  publishMatchChanged,
  publishUserChanged,
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
  gateCount: z.number().int().min(0).max(MAX_GATE_COUNT),
});

const createInput = settingsInput.extend({
  access: z.enum(MATCH_ACCESS).default("open"),
});

export type LobbyItem = {
  id: string;
  creatorName: string;
  creatorGuest: boolean;
  cellCount: number;
  gateCount: number;
  access: MatchAccess;
  createdAt: Date;
  deadlineAt: Date;
  request: "none" | "pending" | "declined";
};

/**
 * Waiting, unexpired matches with the caller's own request state (always
 * "none" for a visitor, `callerId` null). Never
 * selects `code` or any maze column: the lobby is not a way into a match.
 */
async function waitingMatches(
  db: DbClient,
  callerId: string | null,
  now: Date,
  opts: { excludeCreator?: string; matchId?: string } = {},
) {
  const rows = await db
    .select({
      id: match.id,
      creatorId: match.createdById,
      creatorName: user.name,
      creatorGuest: user.isAnonymous,
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
        callerId === null ? sql`false` : eq(matchRequest.userId, callerId),
      ),
    )
    .where(
      and(
        eq(match.status, "awaiting_opponent"),
        gt(match.deadlineAt, now),
        opts.excludeCreator
          ? ne(match.createdById, opts.excludeCreator)
          : undefined,
        opts.matchId ? eq(match.id, opts.matchId) : undefined,
      ),
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
 * The `contentHash` of every maze the opponent has already faced in some
 * other match. Rule 4 of §6: reuse is what makes the library worth having,
 * but not against someone who has already walked the maze — which requires
 * that match to have actually reached `running`. Compared by content, not
 * id, so an unchanged copy ("Edit of …") is the same maze it was copied
 * from.
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

  // A used maze always has its hash: it validated on its way in.
  const faced = await db
    .select({ contentHash: maze.contentHash })
    .from(matchPlayer)
    .innerJoin(maze, eq(maze.id, matchPlayer.mazeId))
    .where(
      and(
        inArray(matchPlayer.matchId, ids),
        ne(matchPlayer.userId, opponentId),
      ),
    );

  return faced
    .map((f) => f.contentHash)
    .filter((hash): hash is string => hash !== null);
}

/** The match must still be waiting for an opponent and inside its deadline. */
function waitingOrThrow(
  row: { status: string; deadlineAt: Date },
  now: Date,
): void {
  if (
    row.status !== "awaiting_opponent" ||
    now.getTime() >= row.deadlineAt.getTime()
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "errors.matchExpired" });
  }
}

export const matchRouter = createTRPCRouter({
  create: memberProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      let abandonedId: string | null = null;

      // A waiting match past its deadline no longer counts, but the
      // partial unique index below still would; close it here rather than
      // make the creator wait for the sweep. Another request may have closed
      // it first, which `closeIfExpired` tolerates. A live one is refused by
      // `assertFree` inside the transaction.
      const [expired] = await ctx.db
        .select({ id: match.id })
        .from(match)
        .where(
          and(
            eq(match.createdById, ctx.session.user.id),
            eq(match.status, "awaiting_opponent"),
            lte(match.deadlineAt, now),
          ),
        );
      if (expired) {
        abandonedId = (await closeIfExpired(ctx.db, expired.id, now))
          ? expired.id
          : null;
      }

      // The unique index is the real guard against a collision; these
      // attempts just make hitting it vanishingly unlikely before the
      // database has to say so.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = makeCode((max) => Math.floor(Math.random() * max));
        try {
          const created = await ctx.db.transaction(async (tx) => {
            await assertFree(
              tx,
              ctx.session.user.id,
              now,
              "errors.alreadyActive",
              "errors.alreadyWaiting",
            );
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
          // A page watching the old match should learn it was abandoned.
          if (abandonedId) await publishMatchChanged(abandonedId);
          await publishLobbyChanged();
          return created;
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          // A backstop: the player lock in `assertFree` already keeps two
          // concurrent creates apart, and the partial unique index lets only
          // one through regardless.
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
        await assertFree(tx, ctx.session.user.id, now, "errors.alreadyActive");

        await seatOpponent(tx, row, players, ctx.session.user.id, now);

        return { id: row.id };
      });

      await publishMatchChanged(joined.id);
      await publishLobbyChanged();
      return joined;
    }),

  lobby: publicProcedure.query(async ({ ctx }) => {
    const you = ctx.session?.user.id ?? null;
    const rows = await waitingMatches(ctx.db, you, new Date(), {
      excludeCreator: you ?? undefined,
    });
    return { you, matches: rows.map((r) => r.item) };
  }),

  preview: publicProcedure
    .input(z.object({ matchId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [found] = await waitingMatches(
        ctx.db,
        ctx.session?.user.id ?? null,
        new Date(),
        { matchId: input.matchId },
      );
      if (!found) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "errors.matchNotFound",
        });
      }
      return {
        ...found.item,
        isYours: found.creatorId === ctx.session?.user.id,
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
            .select({ id: user.id, name: user.name, guest: user.isAnonymous })
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
              guest: names[0]?.guest ?? false,
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
    const now = new Date();
    const rows = await ctx.db
      .select({
        id: match.id,
        code: match.code,
        status: match.status,
        cellCount: match.cellCount,
        gateCount: match.gateCount,
        deadlineAt: match.deadlineAt,
        winnerId: match.winnerId,
        createdAt: match.createdAt,
        finishedAt: matchPlayer.finishedAt,
        gaveUpAt: matchPlayer.gaveUpAt,
        forfeitedAt: matchPlayer.forfeitedAt,
      })
      .from(matchPlayer)
      .innerJoin(match, eq(match.id, matchPlayer.matchId))
      .where(eq(matchPlayer.userId, ctx.session.user.id))
      .orderBy(desc(match.createdAt));

    // The match that holds the caller first, then the rest still going (a
    // finished run waiting on the opponent's), then the ones that are over;
    // newest first within each.
    const rank = (r: { active: boolean; status: MatchStatus }) =>
      r.active ? 0 : isTerminal(r.status) ? 2 : 1;
    // A guest keeps no history: their finished matches are not listed.
    const visible = ctx.session.user.isAnonymous
      ? rows.filter((r) => !isTerminal(r.status))
      : rows;
    return visible
      .map(({ finishedAt, gaveUpAt, forfeitedAt, winnerId, ...row }) => ({
        ...row,
        active: holdsPlayer(row, { finishedAt, gaveUpAt, forfeitedAt }, now),
        won: winnerId === ctx.session.user.id,
      }))
      .sort((a, b) => rank(a) - rank(b));
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
        // validates at these exact settings — a half-drawn one has none, so
        // this is exactly the predicate that keeps `submitMaze` from
        // rejecting a choice the picker just offered as valid. The concept
        // comes along either way: the picker offers a half-drawn one to
        // finish, never to use.
        or(isNotNull(maze.contentHash), eq(maze.concept, true)),
        isNull(maze.deletedAt),
      ];
      if (faced.length > 0) {
        // A half-drawn concept has no hash, and is not a faced maze.
        conditions.push(
          or(isNull(maze.contentHash), notInArray(maze.contentHash, faced)),
        );
      }

      // `data` is for the picker's previews. Author-facing: the first
      // condition limits this to the caller's own mazes, never the
      // opponent's (invariant 1).
      const rows = await ctx.db
        .select({
          id: maze.id,
          name: maze.name,
          updatedAt: maze.updatedAt,
          concept: maze.concept,
          contentHash: maze.contentHash,
          data: maze.data,
        })
        .from(maze)
        .where(and(...conditions))
        .orderBy(desc(maze.concept), desc(maze.updatedAt));
      return rows.map(({ contentHash, ...row }) => ({
        ...row,
        valid: contentHash !== null,
        data: draftMazeSchema.parse(row.data),
      }));
    }),

  requestJoin: protectedProcedure
    .input(z.object({ matchId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const userId = ctx.session.user.id;

      await ctx.db.transaction(async (tx) => {
        // Locked, so a request racing an accept cannot leave a pending row
        // on a match that has just become `drawing`.
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
        if (row.createdById === userId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.alreadyInMatch",
          });
        }
        waitingOrThrow(row, now);
        if (row.access !== "locked") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.matchNotLocked",
          });
        }
        await assertFree(tx, userId, now, "errors.alreadyActive");

        const [existing] = await tx
          .select()
          .from(matchRequest)
          .where(
            and(
              eq(matchRequest.matchId, row.id),
              eq(matchRequest.userId, userId),
            ),
          );
        if (existing?.declinedAt) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.requestDeclined",
          });
        }
        if (!existing) {
          await tx
            .insert(matchRequest)
            .values({ matchId: row.id, userId, createdAt: now });
        }
      });

      await publishMatchChanged(input.matchId);
      await publishUserChanged(userId);
      return { id: input.matchId };
    }),

  withdrawRequest: protectedProcedure
    .input(z.object({ matchId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        // Locked like every other writer of this match's requests.
        await tx
          .select({ id: match.id })
          .from(match)
          .where(eq(match.id, input.matchId))
          .for("update");
        // A declined row stays: withdrawing must not lift a decline.
        await tx
          .delete(matchRequest)
          .where(
            and(
              eq(matchRequest.matchId, input.matchId),
              eq(matchRequest.userId, ctx.session.user.id),
              isNull(matchRequest.declinedAt),
            ),
          );
      });

      await publishMatchChanged(input.matchId);
      await publishUserChanged(ctx.session.user.id);
      return { id: input.matchId };
    }),

  requests: protectedProcedure
    .input(z.object({ matchId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ createdById: match.createdById })
        .from(match)
        .where(eq(match.id, input.matchId));
      if (row?.createdById !== ctx.session.user.id) notYours();

      return ctx.db
        .select({
          userId: matchRequest.userId,
          name: user.name,
          guest: user.isAnonymous,
          createdAt: matchRequest.createdAt,
        })
        .from(matchRequest)
        .innerJoin(user, eq(user.id, matchRequest.userId))
        .where(
          and(
            eq(matchRequest.matchId, input.matchId),
            isNull(matchRequest.declinedAt),
          ),
        )
        .orderBy(asc(matchRequest.createdAt));
    }),

  acceptRequest: protectedProcedure
    .input(z.object({ matchId: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      const requesters = await ctx.db.transaction(async (tx) => {
        const found = await participantRows(
          tx,
          input.matchId,
          ctx.session.user.id,
          { lock: true },
        );
        if (found?.row.createdById !== ctx.session.user.id) notYours();
        const { row, players } = found;
        waitingOrThrow(row, now);

        const pending = await tx
          .select()
          .from(matchRequest)
          .where(eq(matchRequest.matchId, row.id));
        const chosen = pending.find((r) => r.userId === input.userId);
        if (!chosen || chosen.declinedAt) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.requestGone",
          });
        }

        await assertFree(tx, input.userId, now, "errors.requesterActive");
        await seatOpponent(tx, row, players, input.userId, now);
        await tx.delete(matchRequest).where(eq(matchRequest.matchId, row.id));
        return pending.map((r) => r.userId);
      });

      await publishMatchChanged(input.matchId);
      await publishLobbyChanged();
      await Promise.all(requesters.map(publishUserChanged));
      return { id: input.matchId };
    }),

  declineRequest: protectedProcedure
    .input(z.object({ matchId: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();

      await ctx.db.transaction(async (tx) => {
        const found = await participantRows(
          tx,
          input.matchId,
          ctx.session.user.id,
          { lock: true },
        );
        if (found?.row.createdById !== ctx.session.user.id) notYours();
        waitingOrThrow(found.row, now);

        const declined = await tx
          .update(matchRequest)
          .set({ declinedAt: now })
          .where(
            and(
              eq(matchRequest.matchId, input.matchId),
              eq(matchRequest.userId, input.userId),
            ),
          )
          .returning({ userId: matchRequest.userId });
        if (declined.length === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.requestGone",
          });
        }
      });

      await publishMatchChanged(input.matchId);
      await publishUserChanged(input.userId);
      return { id: input.matchId };
    }),

  /**
   * Deletes a match nobody has joined yet (spec §9). The players cascade,
   * and no maze can have been submitted to it. Anything past
   * `awaiting_opponent` is refused: the opponent has a stake by then.
   */
  cancel: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const requesters = await ctx.db.transaction(async (tx) => {
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
        // Read before the delete: the cascade takes the rows with the match.
        const pending = await tx
          .select({ userId: matchRequest.userId })
          .from(matchRequest)
          .where(eq(matchRequest.matchId, found.row.id));
        await tx.delete(match).where(eq(match.id, found.row.id));
        return pending.map((r) => r.userId);
      });

      await publishMatchChanged(input.matchId);
      await publishLobbyChanged();
      await Promise.all(requesters.map(publishUserChanged));
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

        // Before the maze row, in the same order `maze.saveConcept` takes
        // them, so a submit and a save of one concept cannot deadlock.
        await lockAuthor(tx, ctx.session.user.id);
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

        // After validating, by the hash just computed: the stored one may
        // be stale or missing on a concept.
        const faced = await mazesFacedBy(tx, them?.userId ?? null, row.id);
        if (faced.includes(validation.contentHash)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "errors.mazeAlreadyFaced",
          });
        }

        // A concept is saved on its way in, back into the labyrinth it was
        // opened from if there is one, so the used labyrinth is in the
        // author's library like any other.
        let mazeId = mazeRow.id;
        if (mazeRow.concept) {
          mazeId = await promoteConcept(
            tx,
            {
              ...mazeRow,
              contentHash: validation.contentHash,
              optimalMoves: validation.optimalMoves,
            },
            { checkLimit: false },
          );
        }

        await tx
          .update(maze)
          .set({
            status: "submitted",
            contentHash: validation.contentHash,
            optimalMoves: validation.optimalMoves,
            // A guest's labyrinth is never kept: the purge removes it once
            // no match can show it.
            ...(ctx.session.user.isAnonymous ? { deletedAt: now } : {}),
          })
          .where(eq(maze.id, mazeId));

        await tx
          .update(matchPlayer)
          .set({ mazeId, submittedAt: now })
          .where(
            and(
              eq(matchPlayer.matchId, row.id),
              eq(matchPlayer.userId, ctx.session.user.id),
            ),
          );

        const seated = players.map((p) =>
          p.userId === ctx.session.user.id
            ? { ...p, mazeId, submittedAt: now }
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
