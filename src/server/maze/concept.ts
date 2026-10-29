import { TRPCError } from "@trpc/server";
import { and, count, eq, or, sql } from "drizzle-orm";

import { IssueCause } from "~/lib/issues";
import { MAZE_LIMIT } from "~/maze";
import { maze, user } from "~/server/db/schema";
import type { DbClient } from "~/server/match/access";

/**
 * Serialises one author's concept and library changes: two tabs replacing
 * their concept, or saving into the last free slot, take turns on this lock.
 */
export async function lockAuthor(tx: DbClient, authorId: string) {
  // Not a plain FOR UPDATE: that would also block every insert whose
  // foreign key points at this user.
  await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, authorId))
    .for("no key update");
}

/**
 * A concept with nothing in it worth keeping: no painted squares, or a copy
 * of a saved labyrinth that still matches it. Opening a saved labyrinth
 * makes such a copy, so just looking at one never leaves a concept to ask
 * about.
 */
export const isDisposable = or(
  sql`jsonb_array_length(${maze.data} -> 'cells') = 0`,
  sql`exists (select 1 from ${maze} as source where source.id = ${maze.sourceId} and source.data = ${maze.data})`,
);

/** The author's concept, if they have one. Call under `lockAuthor`. */
export async function conceptOf(tx: DbClient, authorId: string) {
  const [row] = await tx
    .select({
      id: maze.id,
      name: maze.name,
      sourceId: maze.sourceId,
      cellCount: maze.cellCount,
      gateCount: maze.gateCount,
      cells: sql<number>`jsonb_array_length(${maze.data} -> 'cells')`,
      disposable: sql<boolean>`${isDisposable}`,
    })
    .from(maze)
    .where(and(eq(maze.authorId, authorId), eq(maze.concept, true)));
  return row;
}

/**
 * Deletes the author's concept to make way for a new one. Refused with
 * `errors.conceptExists`, naming it, unless `replace` says the author agreed
 * to lose it; a disposable one is lost without asking. Call under
 * `lockAuthor`.
 */
export async function dropConcept(
  tx: DbClient,
  existing: { id: string; name: string; disposable: boolean } | undefined,
  replace: boolean,
) {
  if (!existing) return;
  if (!replace && !existing.disposable) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "errors.conceptExists",
      cause: new IssueCause({
        key: "errors.conceptExists",
        params: { name: existing.name },
      }),
    });
  }
  await tx.delete(maze).where(eq(maze.id, existing.id));
}

/**
 * Makes a valid concept a saved labyrinth and returns the saved one's id. A
 * concept opened from a labyrinth is written back into it; when that one
 * has since been deleted, the concept is saved on its own instead. `checkLimit` refuses a new labyrinth beyond `MAZE_LIMIT`; using a
 * concept in a match skips it, as a match must never be blocked by the
 * library. Call under `lockAuthor`, after validating the concept.
 */
export async function promoteConcept(
  tx: DbClient,
  concept: {
    id: string;
    authorId: string;
    sourceId: string | null;
    data: unknown;
    contentHash: string | null;
    optimalMoves: number | null;
  },
  { checkLimit }: { checkLimit: boolean },
): Promise<string> {
  if (concept.sourceId) {
    const [into] = await tx
      .update(maze)
      .set({
        data: concept.data,
        contentHash: concept.contentHash,
        optimalMoves: concept.optimalMoves,
        version: sql`${maze.version} + 1`,
      })
      .where(
        and(
          eq(maze.id, concept.sourceId),
          eq(maze.authorId, concept.authorId),
          eq(maze.concept, false),
        ),
      )
      .returning({ id: maze.id });
    if (into) {
      await tx.delete(maze).where(eq(maze.id, concept.id));
      return into.id;
    }
  }

  if (checkLimit) {
    const [kept] = await tx
      .select({ n: count() })
      .from(maze)
      .where(and(eq(maze.authorId, concept.authorId), eq(maze.concept, false)));
    if ((kept?.n ?? 0) >= MAZE_LIMIT) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "errors.mazeLimitReached",
      });
    }
  }

  await tx
    .update(maze)
    .set({ concept: false, sourceId: null })
    .where(eq(maze.id, concept.id));
  return concept.id;
}
