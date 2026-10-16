import { TRPCError } from "@trpc/server";

import type { db as Database } from "~/server/db";
import { sweepExpiredMatches } from "~/server/match/sweep";

/**
 * tRPC rejects with a `TRPCError`. A bare `rejects.toThrow()` would also
 * pass on a connection failure, so match the code the procedure actually
 * threw.
 */
export async function rejection(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (!(error instanceof TRPCError)) throw error;
    return { code: error.code, message: error.message };
  }
  throw new Error("expected the call to reject, but it resolved");
}

/**
 * Sweeps until nothing due is left. One call closes at most
 * `SWEEP_BATCH_LIMIT` matches, oldest deadline first, and the shared test
 * database is never reset, so leftovers from other suites can fill the batch
 * before it reaches the match a test is asserting on.
 */
export async function sweepAll(db: typeof Database, at: Date) {
  while ((await sweepExpiredMatches(db, at)).capped) {
    // drain
  }
}
