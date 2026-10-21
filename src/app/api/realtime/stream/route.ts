import { EVENTS, isPresenceChannel } from "~/match";
import { getSession } from "~/server/auth";
import { db } from "~/server/db";
import { pusherConfigured } from "~/server/realtime";
import { canSubscribe } from "~/server/realtime/access";
import { join, memberCount, subscribe } from "~/server/realtime/local-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEEP_ALIVE_MS = 25_000;

/**
 * Spec §8.1: the local transport. Streams the in-process bus to one browser
 * as server-sent events, and holds its presence while the connection is
 * open. With Pusher configured this route does not exist — two live
 * transports would be two places for a subscription rule to drift.
 */
export async function GET(request: Request) {
  // On Vercel without keys the bus reaches only whichever instance a publish
  // lands on, and each open stream holds a function until it times out. A 404
  // stops EventSource retrying, so clients poll instead.
  if (pusherConfigured || process.env.VERCEL) {
    return new Response("Not found", { status: 404 });
  }

  const session = await getSession(request.headers);
  if (!session) return new Response("Unauthorized", { status: 401 });

  const channel = new URL(request.url).searchParams.get("channel") ?? "";
  if (!(await canSubscribe(db, session.user.id, channel))) {
    return new Response("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();
  let stop = () => undefined as void;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));
      const send = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const off = subscribe(channel, send);
      let leave = () => undefined as void;
      if (isPresenceChannel(channel)) {
        leave = join(channel, session.user.id);
        // `join` announces only a change in distinct users, so a second tab
        // of the same user would otherwise never learn the count.
        send(EVENTS.members, { count: memberCount(channel) });
      }
      const keepAlive = setInterval(
        () => write(": keep-alive\n\n"),
        KEEP_ALIVE_MS,
      );

      let stopped = false;
      stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(keepAlive);
        off();
        leave();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };
      request.signal.addEventListener("abort", () => stop(), { once: true });
      // The client may have left while the session or DB check was awaited.
      if (request.signal.aborted) stop();
    },
    cancel() {
      stop();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
