import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  deadlineFor,
  decidingField,
  elapsedMs,
  isTerminal,
  mayReplayOwn,
  mayWatchOpponent,
  resolveCompletion,
  runChannel,
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
  withPassages,
  type Maze,
  type Point,
} from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { match, matchPlayer, maze, move, user } from "~/server/db/schema";
import {
  lockedForMove,
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
import { watchFactsFor } from "~/server/realtime/access";

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
  // The sweep runs once a day (vercel.json); between a deadline passing and
  // the sweep closing the match, nothing may change it.
  if (now.getTime() >= row.deadlineAt.getTime()) refuse("errors.matchExpired");
}

/**
 * Parsed mazes by id, for `run.move`. A submitted maze can be neither saved
 * nor removed (`maze.saveDraft`, `maze.remove`), and a run only ever solves
 * a submitted one, so an entry can never go stale. Server memory only; the
 * cap keeps a long-lived process from growing without bound.
 */
const solvingCache = new Map<string, Maze>();
const SOLVING_CACHE_MAX = 500;

/**
 * The maze this runner is solving: the opponent's. **This reads
 * `maze.data` on a runner-reachable path** — the one sanctioned place
 * besides `run.result` (see `routers/AGENTS.md`). What it returns must never
 * leave the server; `run.move` hands it only to the reducer.
 */
async function mazeToSolve(tx: DbClient, opponent: PlayerRow): Promise<Maze> {
  const id = opponent.mazeId!;
  const cached = solvingCache.get(id);
  if (cached) return cached;
  const [row] = await tx
    .select({ data: maze.data })
    .from(maze)
    .where(eq(maze.id, id));
  const parsed = mazeSchema.parse(row!.data);
  if (solvingCache.size >= SOLVING_CACHE_MAX) {
    solvingCache.delete(solvingCache.keys().next().value!);
  }
  solvingCache.set(id, parsed);
  return parsed;
}

/** Looks up display names once; an unknown id reads as "". */
async function displayNames(
  db: DbClient,
  ids: string[],
): Promise<(id: string) => string> {
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, ids));
  return (id) => rows.find((r) => r.id === id)?.name ?? "";
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
        map: withPassages(view.map),
        heldKeys: heldKeys(view.map),
        penalties: you.runState?.state.penalties ?? 0,
        moves,
        nextSeq: moves + 1,
        finished: you.finishedAt !== null,
        gaveUp: you.gaveUpAt !== null,
        /** The runner's own time, once they reach the treasure (§2.6). */
        elapsedMs: elapsedMs(factsFor(you)),
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
        const found = await lockedForMove(tx, input.matchId, me, input.seq);
        if (!found) notYours();
        const { row, players, stored } = found;

        // §7.2, and before every other check: a retry gets what the first
        // attempt got, even if that attempt finished the run or the match.
        if (stored) {
          return {
            delta: stored,
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

        const updated: PlayerRow = {
          ...you,
          runState: run,
          startedAt: you.startedAt ?? now,
          lastMoveAt: now,
          finishedAt: delta.finished ? now : null,
        };
        const seated = players.map((p) => (p.userId === me ? updated : p));
        const completion = resolveCompletion(seated.map(factsFor));

        // The move row, the run state and the match in one statement: data-
        // modifying CTEs all run, on rows this transaction already holds
        // locked, and a failure in any of them fails the whole statement —
        // so nothing about atomicity changes, only the round trips.
        const logged = tx.$with("logged").as(
          tx
            .insert(move)
            .values({
              matchId: row.id,
              runnerId: me,
              seq: input.seq,
              dir: input.dir,
              outcome,
              delta,
              createdAt: now,
            })
            .returning({ id: move.id }),
        );
        const ran = tx.$with("ran").as(
          tx
            .update(matchPlayer)
            .set({
              runState: updated.runState,
              startedAt: updated.startedAt,
              lastMoveAt: updated.lastMoveAt,
              finishedAt: updated.finishedAt,
            })
            .where(
              and(eq(matchPlayer.matchId, row.id), eq(matchPlayer.userId, me)),
            )
            .returning({ userId: matchPlayer.userId }),
        );
        await tx
          .with(logged, ran)
          .update(match)
          .set(
            completion.kind === "complete"
              ? {
                  status: "complete",
                  winnerId: completion.winnerId,
                  endReason: completion.endReason,
                  lastActivityAt: now,
                  endedAt: now,
                }
              : {
                  lastActivityAt: now,
                  deadlineAt: deadlineFor(
                    situationFor({ ...row, lastActivityAt: now }, seated),
                  )!,
                },
          )
          .where(eq(match.id, row.id));

        return {
          delta,
          matchOver: completion.kind === "complete",
          fresh: true as const,
        };
      });

      // After commit (spec §8): a publish inside the transaction could
      // announce a move that rolls back, and would hold the row lock across
      // a network call. A replayed seq was announced the first time.
      // A finished run pings the match too, even when the match goes on: a
      // watcher whose move event was dropped would otherwise stay "live".
      // Awaited, not fired off: the move queue sends one move at a time, so
      // this keeps each runner's published moves in seq order.
      if (outcome.fresh) {
        await Promise.all([
          publishMove(input.matchId, me, {
            seq: input.seq,
            delta: outcome.delta,
          }),
          outcome.matchOver || outcome.delta.finished
            ? publishMatchChanged(input.matchId)
            : undefined,
        ]);
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
            endedAt: now,
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

      const nameOf = await displayNames(
        ctx.db,
        players.map((p) => p.userId),
      );

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
  /**
   * Spec §8: the watch and replay page's one read. The third sanctioned
   * reader of `maze.data` (routers/AGENTS.md): for "opponent" it is your
   * own maze, and for "mine" the opponent's, only once the match is over.
   */
  replay: protectedProcedure
    .input(
      z.object({ matchId: z.string(), whose: z.enum(["opponent", "mine"]) }),
    )
    .query(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      const found = await participantRows(ctx.db, input.matchId, me);
      if (!found) notYours();
      const { row, players } = found;

      const facts = watchFactsFor(row, players, me);
      if (input.whose === "opponent" && !mayWatchOpponent(facts)) {
        refuse("errors.watchNotYet");
      }
      if (input.whose === "mine" && !mayReplayOwn(facts)) {
        refuse("errors.replayNotReady");
      }

      const you = players.find((p) => p.userId === me)!;
      const them = players.find((p) => p.userId !== me)!;
      // §6: a runner walks the *other* player's maze.
      const runner = input.whose === "opponent" ? them : you;
      const author = input.whose === "opponent" ? you : them;

      const [[mazeRow], log, nameOf] = await Promise.all([
        ctx.db
          .select({ data: maze.data })
          .from(maze)
          .where(eq(maze.id, author.mazeId!)),
        ctx.db
          .select({ seq: move.seq, delta: move.delta })
          .from(move)
          .where(
            and(eq(move.matchId, row.id), eq(move.runnerId, runner.userId)),
          )
          .orderBy(asc(move.seq)),
        displayNames(ctx.db, [runner.userId, author.userId]),
      ]);

      const live =
        !isTerminal(row.status) &&
        runner.finishedAt === null &&
        runner.gaveUpAt === null;

      return {
        maze: mazeSchema.parse(mazeRow!.data),
        moves: log,
        live,
        channel: live ? runChannel(row.id, runner.userId) : null,
        runnerName: nameOf(runner.userId),
        authorName: nameOf(author.userId),
      };
    }),
});
