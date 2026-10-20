import { isPresenceChannel } from "~/match";
import { getSession } from "~/server/auth";
import { db } from "~/server/db";
import { getPusher } from "~/server/realtime";
import { canSubscribe } from "~/server/realtime/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pusher's channel authorisation (spec §8.1). Same rule as the local stream:
 * `canSubscribe`. Presence channels carry the user id and nothing else.
 */
export async function POST(request: Request) {
  const pusher = getPusher();
  if (!pusher) return new Response("Not found", { status: 404 });

  const session = await getSession(request.headers);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  const socketField = form.get("socket_id");
  const channelField = form.get("channel_name");
  const socketId = typeof socketField === "string" ? socketField : "";
  const channel = typeof channelField === "string" ? channelField : "";
  if (!(await canSubscribe(db, session.user.id, channel))) {
    return new Response("Forbidden", { status: 403 });
  }

  const response = isPresenceChannel(channel)
    ? pusher.authorizeChannel(socketId, channel, { user_id: session.user.id })
    : pusher.authorizeChannel(socketId, channel);
  return Response.json(response);
}
