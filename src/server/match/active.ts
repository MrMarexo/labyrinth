import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";

import { holdsPlayer } from "~/match";
import { match, matchPlayer } from "~/server/db/schema";
import type { DbClient } from "~/server/match/access";

/**
 * The match that currently holds `userId` (see `holdsPlayer`), or null. A
 * player is held by at most one, which every way into a match checks.
 */
export async function activeMatchOf(
  db: DbClient,
  userId: string,
  now: Date,
): Promise<{ id: string; status: string } | null> {
  const rows = await db
    .select({
      id: match.id,
      status: match.status,
      deadlineAt: match.deadlineAt,
      finishedAt: matchPlayer.finishedAt,
      gaveUpAt: matchPlayer.gaveUpAt,
      forfeitedAt: matchPlayer.forfeitedAt,
    })
    .from(matchPlayer)
    .innerJoin(match, eq(match.id, matchPlayer.matchId))
    .where(
      and(
        eq(matchPlayer.userId, userId),
        inArray(match.status, ["awaiting_opponent", "drawing", "running"]),
      ),
    );
  const held = rows.find((r) => holdsPlayer(r, r, now));
  return held ? { id: held.id, status: held.status } : null;
}

/**
 * Refuses to put `userId` into another match while one holds them. Inside a
 * transaction it first takes a lock on the player, held until commit, so two
 * joins by the same player cannot both pass the check. Callers that lock a
 * match row take it before this, always in that order.
 *
 * `whenWaiting`, if given, replaces `message` when what holds them is their
 * own match still waiting for an opponent — the one case `create` words
 * more precisely.
 */
export async function assertFree(
  tx: DbClient,
  userId: string,
  now: Date,
  message: "errors.alreadyActive" | "errors.requesterActive",
  whenWaiting?: "errors.alreadyWaiting",
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`player:${userId}`}))`,
  );
  const held = await activeMatchOf(tx, userId, now);
  if (!held) return;
  throw new TRPCError({
    code: "CONFLICT",
    message:
      whenWaiting && held.status === "awaiting_opponent"
        ? whenWaiting
        : message,
  });
}
