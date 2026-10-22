import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { type NeonQueryResultHKT } from "drizzle-orm/neon-serverless";
import { type PgDatabase } from "drizzle-orm/pg-core";

import { match, matchPlayer, move } from "~/server/db/schema";
import type * as schema from "~/server/db/schema";

/**
 * Both the pooled client and an open transaction on it satisfy this, so a
 * helper can be called inside or outside one. `typeof db` would not do: a
 * transaction object lacks `$client`.
 */
export type DbClient = PgDatabase<NeonQueryResultHKT, typeof schema>;

/**
 * Every read of a match the caller must be part of.
 *
 * `lock` takes `FOR UPDATE` on the match row and both player rows, which is
 * what serialises everything that can change a running match — two moves on
 * the same `seq`, a move racing the opponent's give-up, both players
 * finishing at once. The match row is locked first, always, so two
 * transactions on the same match can never wait on each other in opposite
 * orders. It only means anything inside a transaction.
 */
export async function participantRows(
  tx: DbClient,
  matchId: string,
  userId: string,
  options: { lock?: boolean } = {},
) {
  const matchQuery = tx.select().from(match).where(eq(match.id, matchId));
  const [row] = await (options.lock ? matchQuery.for("update") : matchQuery);
  if (!row) return null;

  const playersQuery = tx
    .select()
    .from(matchPlayer)
    .where(eq(matchPlayer.matchId, matchId));
  const players = await (options.lock
    ? playersQuery.for("update")
    : playersQuery);
  if (!players.some((p) => p.userId === userId)) return null;

  return { row, players };
}

/**
 * `participantRows` with `lock`, for `run.move`, with the caller's stored
 * delta for `seq` (spec §7.2) read in the same statement as the player rows
 * — one round trip fewer on the hottest path in the game.
 *
 * The lock order is unchanged: the match row in its own statement first,
 * then both player rows. Because every writer takes the match lock first,
 * the second statement starts after any earlier holder committed, and its
 * snapshot sees that holder's move row — which is what makes a retried or
 * concurrent `seq` find the stored delta here exactly as a separate query
 * would. The join is `FOR UPDATE OF match_player`: the move row is read,
 * never locked.
 */
export async function lockedForMove(
  tx: DbClient,
  matchId: string,
  userId: string,
  seq: number,
) {
  const [row] = await tx
    .select()
    .from(match)
    .where(eq(match.id, matchId))
    .for("update");
  if (!row) return null;

  const joined = await tx
    .select({ player: matchPlayer, stored: move.delta })
    .from(matchPlayer)
    .leftJoin(
      move,
      and(
        eq(matchPlayer.userId, userId),
        eq(move.matchId, matchPlayer.matchId),
        eq(move.runnerId, matchPlayer.userId),
        eq(move.seq, seq),
      ),
    )
    .where(eq(matchPlayer.matchId, matchId))
    .for("update", { of: matchPlayer });
  const players = joined.map((j) => j.player);
  if (!players.some((p) => p.userId === userId)) return null;
  const stored = joined.find((j) => j.player.userId === userId)?.stored ?? null;

  return { row, players, stored };
}

/**
 * A match the caller is not in and a match that does not exist get the same
 * answer: distinguishing them would confirm the match exists to someone with
 * no business knowing.
 */
export function notYours(): never {
  throw new TRPCError({ code: "FORBIDDEN", message: "errors.notYourMatch" });
}
