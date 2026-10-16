import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  deadlineFor,
  isTerminal,
  resolveCompletion,
  type RunFacts,
} from "~/match";
import {
  DIRECTIONS,
  advanceRun,
  emptyMap,
  freshRun,
  heldKeys,
  mazeSchema,
  type Maze,
} from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { match, matchPlayer, maze, move } from "~/server/db/schema";
import {
  notYours,
  participantRows,
  type DbClient,
} from "~/server/match/access";
import {
  situationFor,
  type MatchRow,
  type PlayerRow,
} from "~/server/match/situation";

function refuse(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

export function factsFor(p: PlayerRow): RunFacts {
  return {
    userId: p.userId,
    startedAt: p.startedAt,
    finishedAt: p.finishedAt,
    gaveUpAt: p.gaveUpAt,
    penalties: p.runState?.state.penalties ?? 0,
    moves: p.runState?.state.moves ?? 0,
  };
}

/** The refusals shared by everything that changes a run. */
export function assertRunOpen(row: MatchRow, now: Date) {
  if (isTerminal(row.status)) refuse("errors.matchOver");
  if (row.status !== "running") refuse("errors.runNotUnlocked");
  // The sweep runs every 15 minutes; between a deadline passing and the
  // sweep closing the match, nothing may change it.
  if (now.getTime() >= row.deadlineAt.getTime()) refuse("errors.matchExpired");
}

/**
 * The maze this runner is solving: the opponent's. **This reads
 * `maze.data` on a runner-reachable path** — the one sanctioned place
 * besides `run.result` (see `routers/AGENTS.md`). What it returns must never
 * leave the server; `run.move` hands it only to the reducer.
 */
async function mazeToSolve(tx: DbClient, opponent: PlayerRow): Promise<Maze> {
  const [row] = await tx
    .select({ data: maze.data })
    .from(maze)
    .where(eq(maze.id, opponent.mazeId!));
  return mazeSchema.parse(row!.data);
}

export const runRouter = createTRPCRouter({
  /**
   * The runner's own view. Reads `runState.view` and never touches
   * `maze.data`: everything here was already sent to this runner as a delta.
   */
  get: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const found = await participantRows(
        ctx.db,
        input.matchId,
        ctx.session.user.id,
      );
      if (!found) notYours();

      const you = found.players.find((p) => p.userId === ctx.session.user.id)!;
      const view = you.runState?.view ?? {
        at: { x: 0, y: 0 },
        map: emptyMap(),
      };
      const moves = you.runState?.state.moves ?? 0;

      return {
        status: found.row.status,
        at: view.at,
        map: view.map,
        heldKeys: heldKeys(view.map),
        penalties: you.runState?.state.penalties ?? 0,
        moves,
        nextSeq: moves + 1,
        finished: you.finishedAt !== null,
        gaveUp: you.gaveUpAt !== null,
      };
    }),

  move: protectedProcedure
    .input(
      z.object({
        matchId: z.string(),
        seq: z.number().int().min(1),
        dir: z.enum(DIRECTIONS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const me = ctx.session.user.id;

      return ctx.db.transaction(async (tx) => {
        const found = await participantRows(tx, input.matchId, me, {
          lock: true,
        });
        if (!found) notYours();
        const { row, players } = found;

        // §7.2, and before every other check: a retry gets what the first
        // attempt got, even if that attempt finished the run or the match.
        const [stored] = await tx
          .select({ delta: move.delta })
          .from(move)
          .where(
            and(
              eq(move.matchId, row.id),
              eq(move.runnerId, me),
              eq(move.seq, input.seq),
            ),
          );
        if (stored) {
          return { delta: stored.delta, matchOver: isTerminal(row.status) };
        }

        assertRunOpen(row, now);
        const you = players.find((p) => p.userId === me)!;
        const them = players.find((p) => p.userId !== me)!;
        if (you.finishedAt !== null) refuse("errors.runAlreadyFinished");

        const solving = await mazeToSolve(tx, them);
        const current = you.runState ?? freshRun(solving);
        if (input.seq !== current.state.moves + 1) {
          refuse("errors.moveOutOfOrder");
        }

        const { run, delta, outcome } = advanceRun(current, solving, input.dir);

        await tx.insert(move).values({
          matchId: row.id,
          runnerId: me,
          seq: input.seq,
          dir: input.dir,
          outcome,
          delta,
          createdAt: now,
        });

        const updated: PlayerRow = {
          ...you,
          runState: run,
          startedAt: you.startedAt ?? now,
          lastMoveAt: now,
          finishedAt: delta.finished ? now : null,
        };
        await tx
          .update(matchPlayer)
          .set({
            runState: updated.runState,
            startedAt: updated.startedAt,
            lastMoveAt: updated.lastMoveAt,
            finishedAt: updated.finishedAt,
          })
          .where(
            and(eq(matchPlayer.matchId, row.id), eq(matchPlayer.userId, me)),
          );

        const seated = players.map((p) => (p.userId === me ? updated : p));
        const completion = resolveCompletion(seated.map(factsFor));

        if (completion.kind === "complete") {
          await tx
            .update(match)
            .set({
              status: "complete",
              winnerId: completion.winnerId,
              endReason: completion.endReason,
              lastActivityAt: now,
            })
            .where(eq(match.id, row.id));
        } else {
          const next = { ...row, lastActivityAt: now };
          await tx
            .update(match)
            .set({
              lastActivityAt: now,
              deadlineAt: deadlineFor(situationFor(next, seated))!,
            })
            .where(eq(match.id, row.id));
        }

        return { delta, matchOver: completion.kind === "complete" };
      });
    }),
});
