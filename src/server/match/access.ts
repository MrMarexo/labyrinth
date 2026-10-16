import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { type NeonQueryResultHKT } from "drizzle-orm/neon-serverless";
import { type PgDatabase } from "drizzle-orm/pg-core";

import { match, matchPlayer } from "~/server/db/schema";
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
 * A match the caller is not in and a match that does not exist get the same
 * answer: distinguishing them would confirm the match exists to someone with
 * no business knowing.
 */
export function notYours(): never {
  throw new TRPCError({ code: "FORBIDDEN", message: "errors.notYourMatch" });
}
