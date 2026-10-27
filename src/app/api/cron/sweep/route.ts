import { env } from "~/env";
import { db } from "~/server/db";
import { purgeIdleGuests } from "~/server/guest/purge";
import { sweepExpiredMatches } from "~/server/match/sweep";
import { purgeDeletedMazes } from "~/server/maze/purge";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron hits this on a schedule (see vercel.json). It is a plain route
 * rather than a tRPC procedure because the caller is a cron runner with a
 * bearer token, not a signed-in person with a session.
 *
 * With no secret configured the route refuses everything. An endpoint that
 * closes matches must not be open merely because an environment variable was
 * forgotten.
 */
export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return new Response("Not configured", { status: 404 });
  }
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const result = await sweepExpiredMatches(db, now);
  const purge = await purgeDeletedMazes(db, now);
  const guests = await purgeIdleGuests(db, now);
  return Response.json({ ...result, purge, guests });
}
