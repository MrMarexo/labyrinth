import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  deadlineFor,
  decidingField,
  elapsedMs,
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
  pathFrom,
  type Maze,
  type Point,
} from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { match, matchPlayer, maze, move, user } from "~/server/db/schema";
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
import { publishMatchChanged, publishMove } from "~/server/realtime/events";

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

      const outcome = await ctx.db.transaction(async (tx) => {
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
          return {
            delta: stored.delta,
            matchOver: isTerminal(row.status),
            fresh: false as const,
          };
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

        return {
          delta,
          matchOver: completion.kind === "complete",
          fresh: true as const,
        };
      });

      // After commit (spec §8): a publish inside the transaction could
      // announce a move that rolls back, and would hold the row lock across
      // a network call. A replayed seq was announced the first time.
      if (outcome.fresh) {
        await publishMove(input.matchId, me, {
          seq: input.seq,
          delta: outcome.delta,
        });
        if (outcome.matchOver) await publishMatchChanged(input.matchId);
      }
      return { delta: outcome.delta, matchOver: outcome.matchOver };
    }),

  /** Spec §9.2. Confirmed in the client; irreversible here. */
  giveUp: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const me = ctx.session.user.id;

      const result = await ctx.db.transaction(async (tx) => {
        const found = await participantRows(tx, input.matchId, me, {
          lock: true,
        });
        if (!found) notYours();
        const { row, players } = found;

        assertRunOpen(row, now);
        const you = players.find((p) => p.userId === me)!;
        if (you.finishedAt !== null) refuse("errors.runAlreadyFinished");

        await tx
          .update(matchPlayer)
          .set({ gaveUpAt: now })
          .where(
            and(eq(matchPlayer.matchId, row.id), eq(matchPlayer.userId, me)),
          );

        const seated = players.map((p) =>
          p.userId === me ? { ...p, gaveUpAt: now } : p,
        );
        const completion = resolveCompletion(seated.map(factsFor));
        // A give-up completes the match by definition; `resolveCompletion`
        // returning anything else would be a bug in it, not a state to
        // handle.
        if (completion.kind !== "complete") {
          throw new Error("a give-up must complete the match");
        }

        await tx
          .update(match)
          .set({
            status: "complete",
            winnerId: completion.winnerId,
            endReason: completion.endReason,
            lastActivityAt: now,
          })
          .where(eq(match.id, row.id));

        return { status: "complete" as const };
      });

      await publishMatchChanged(input.matchId);
      return result;
    }),

  /**
   * Spec §10.3.1. Returns both mazes — the second sanctioned reader of
   * `maze.data` (see `routers/AGENTS.md`) — and only once the match is over
   * **and** both players submitted. A match abandoned during `drawing` never
   * exposed either maze to the other player, and `mazesFacedBy` agrees: it
   * counts a maze as faced only once the opponent submitted too. Revealing
   * one here would show a maze its author may still reuse against this
   * opponent.
   */
  result: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      const found = await participantRows(ctx.db, input.matchId, me);
      if (!found) notYours();
      const { row, players } = found;
      if (row.status !== "complete" && row.status !== "abandoned") {
        refuse("errors.resultNotReady");
      }

      const you = players.find((p) => p.userId === me)!;
      const them = players.find((p) => p.userId !== me) ?? null;

      const names = await ctx.db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(
          inArray(
            user.id,
            players.map((p) => p.userId),
          ),
        );
      const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? "";

      const score = (p: PlayerRow) => ({
        displayName: nameOf(p.userId),
        penalties: p.runState?.state.penalties ?? 0,
        moves: p.runState?.state.moves ?? 0,
        elapsedMs: elapsedMs(factsFor(p)),
        finished: p.finishedAt !== null,
        gaveUp: p.gaveUpAt !== null,
        timedOut: p.forfeitedAt !== null,
      });

      const quitter = players.find((p) => p.gaveUpAt !== null) ?? null;
      const reason =
        row.status === "abandoned"
          ? ("abandoned" as const)
          : quitter
            ? ("gaveUp" as const)
            : row.endReason === "finished"
              ? row.winnerId === null
                ? ("tie" as const)
                : ("treasure" as const)
              : ("timeout" as const);

      let mazes: {
        theirs: { maze: Maze; path: Point[] };
        yours: { maze: Maze; path: Point[] };
      } | null = null;

      if (them && you.submittedAt !== null && them.submittedAt !== null) {
        const mazeRows = await ctx.db
          .select({ id: maze.id, data: maze.data })
          .from(maze)
          .where(inArray(maze.id, [you.mazeId!, them.mazeId!]));
        const log = await ctx.db
          .select({ runnerId: move.runnerId, delta: move.delta })
          .from(move)
          .where(eq(move.matchId, row.id))
          .orderBy(asc(move.seq));

        const load = (id: string) =>
          mazeSchema.parse(mazeRows.find((m) => m.id === id)!.data);
        // Deltas are start-relative (see RunnerDelta); the result draws on
        // the full maze, so translate back by its start cell.
        const pathOn = (m: Maze, runnerId: string) =>
          pathFrom(
            log.filter((l) => l.runnerId === runnerId).map((l) => l.delta),
          ).map((p) => ({ x: p.x + m.start.x, y: p.y + m.start.y }));

        const theirMaze = load(them.mazeId!);
        const yourMaze = load(you.mazeId!);
        mazes = {
          theirs: { maze: theirMaze, path: pathOn(theirMaze, me) },
          yours: { maze: yourMaze, path: pathOn(yourMaze, them.userId) },
        };
      }

      return {
        status: row.status,
        outcome:
          row.winnerId === null
            ? ("none" as const)
            : row.winnerId === me
              ? ("won" as const)
              : ("lost" as const),
        reason,
        gaveUpBy: quitter
          ? quitter.userId === me
            ? ("you" as const)
            : ("opponent" as const)
          : null,
        decidedBy:
          reason === "treasure" && them
            ? decidingField(factsFor(you), factsFor(them))
            : null,
        you: score(you),
        opponent: them ? score(them) : null,
        mazes,
      };
    }),
});
