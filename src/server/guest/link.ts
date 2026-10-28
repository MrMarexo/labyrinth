import {
  and,
  asc,
  eq,
  inArray,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Database } from "~/server/db";
import {
  match,
  matchPlayer,
  matchRequest,
  maze,
  move,
  user,
} from "~/server/db/schema";
import { conceptOf, lockAuthor } from "~/server/maze/concept";

const accountRequest = alias(matchRequest, "account_request");

/**
 * Gives a guest's matches, requests and labyrinths to the account they
 * signed up or signed in as, in one transaction.
 *
 * A match the account already sits in cannot take a second seat, so it stays
 * with the guest, along with the mazes it uses, and `keepGuest` says the
 * guest row must survive to hold it. `changedMatchIds` names the matches
 * whose seats or requests moved, for the caller to publish once this commits.
 */
export async function linkGuest(
  db: typeof Database,
  { guestId, accountId }: { guestId: string; accountId: string },
): Promise<{ keepGuest: boolean; changedMatchIds: string[] }> {
  return db.transaction(async (tx) => {
    await lockAuthor(tx, accountId);
    await lockAuthor(tx, guestId);

    const seats = await tx
      .select({
        matchId: matchPlayer.matchId,
        mazeId: matchPlayer.mazeId,
        submittedAt: matchPlayer.submittedAt,
      })
      .from(matchPlayer)
      .where(eq(matchPlayer.userId, guestId));
    const accountSeats =
      seats.length === 0
        ? []
        : await tx
            .select({ matchId: matchPlayer.matchId })
            .from(matchPlayer)
            .where(
              and(
                eq(matchPlayer.userId, accountId),
                inArray(
                  matchPlayer.matchId,
                  seats.map((s) => s.matchId),
                ),
              ),
            );
    const colliding = new Set(accountSeats.map((s) => s.matchId));
    const moving = seats.filter((s) => !colliding.has(s.matchId));
    const movingIds = moving.map((s) => s.matchId);

    let drawingUnsubmitted = false;
    if (movingIds.length > 0) {
      // Match rows before player rows, as `participantRows` takes them, so
      // a move or give-up racing the link cannot deadlock with it.
      const matches = await tx
        .select({ id: match.id, status: match.status })
        .from(match)
        .where(inArray(match.id, movingIds))
        .orderBy(asc(match.id))
        .for("update");
      const drawing = new Set(
        matches.filter((m) => m.status === "drawing").map((m) => m.id),
      );
      drawingUnsubmitted = moving.some(
        (s) => s.submittedAt === null && drawing.has(s.matchId),
      );

      await tx
        .update(matchPlayer)
        .set({ userId: accountId })
        .where(
          and(
            eq(matchPlayer.userId, guestId),
            inArray(matchPlayer.matchId, movingIds),
          ),
        );
      await tx
        .update(move)
        .set({ runnerId: accountId })
        .where(
          and(eq(move.runnerId, guestId), inArray(move.matchId, movingIds)),
        );
      await tx
        .update(match)
        .set({ winnerId: accountId })
        .where(and(eq(match.winnerId, guestId), inArray(match.id, movingIds)));
    }

    // A request for a match the account already asked for or sits in has
    // nothing to add.
    await tx
      .delete(matchRequest)
      .where(
        and(
          eq(matchRequest.userId, guestId),
          or(
            inArray(
              matchRequest.matchId,
              tx
                .select({ matchId: matchPlayer.matchId })
                .from(matchPlayer)
                .where(eq(matchPlayer.userId, accountId)),
            ),
            inArray(
              matchRequest.matchId,
              tx
                .select({ matchId: accountRequest.matchId })
                .from(accountRequest)
                .where(eq(accountRequest.userId, accountId)),
            ),
          ),
        ),
      );
    const movedRequests = await tx
      .update(matchRequest)
      .set({ userId: accountId })
      .where(eq(matchRequest.userId, guestId))
      .returning({ matchId: matchRequest.matchId });

    // Only one concept per author. The guest's wins while it is the drawing
    // for a match that just moved; the account's is then kept in its
    // library, past the limit if need be, as a match never waits on it.
    const accountConcept = await conceptOf(tx, accountId);
    const guestConcept = await conceptOf(tx, guestId);
    if (accountConcept && guestConcept) {
      if (drawingUnsubmitted) {
        await tx
          .update(maze)
          .set({ concept: false, sourceId: null })
          .where(eq(maze.id, accountConcept.id));
      } else {
        await tx.delete(maze).where(eq(maze.id, guestConcept.id));
      }
    }

    // A guest's submitted maze was marked deleted for the purge; in the
    // account's library it is a used labyrinth like any other.
    const keptMazes = seats
      .filter((s) => colliding.has(s.matchId) && s.mazeId !== null)
      .map((s) => s.mazeId!);
    await tx
      .update(maze)
      .set({
        authorId: accountId,
        deletedAt: sql`CASE WHEN ${maze.status} = 'submitted' THEN NULL ELSE ${maze.deletedAt} END`,
      })
      .where(
        and(
          eq(maze.authorId, guestId),
          keptMazes.length > 0 ? notInArray(maze.id, keptMazes) : undefined,
        ),
      );

    return {
      keepGuest: colliding.size > 0,
      changedMatchIds: [
        ...new Set([...movingIds, ...movedRequests.map((r) => r.matchId)]),
      ],
    };
  });
}

/**
 * Deletes a linked guest's user row. Only one with no seat left: the cascade
 * would take a seat with it, and with it the opponent's match.
 */
export async function removeLinkedGuest(db: typeof Database, guestId: string) {
  await db
    .delete(user)
    .where(
      and(
        eq(user.id, guestId),
        eq(user.isAnonymous, true),
        notExists(
          db
            .select({ one: matchPlayer.userId })
            .from(matchPlayer)
            .where(eq(matchPlayer.userId, guestId)),
        ),
      ),
    );
}
