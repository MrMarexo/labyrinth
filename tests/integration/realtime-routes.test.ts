import { describe, expect, it } from "vitest";

import { EVENTS, runChannel } from "~/match";
import { POST as auth } from "~/app/api/realtime/auth/route";
import { GET as stream } from "~/app/api/realtime/stream/route";
import { emit, memberCount } from "~/server/realtime/local-bus";

import { runningMatch } from "./players";

function streamRequest(channel: string, cookie?: string, signal?: AbortSignal) {
  return new Request(
    `http://localhost/api/realtime/stream?channel=${encodeURIComponent(channel)}`,
    { headers: cookie ? { cookie } : {}, signal },
  );
}

/** Reads the stream until `predicate` matches the text so far, or 5s pass. */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  predicate: (text: string) => boolean,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 5000;
  while (!predicate(text) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  reader.releaseLock();
  return text;
}

describe("GET /api/realtime/stream", () => {
  it("refuses an anonymous request", async () => {
    const { hostId, matchId } = await runningMatch();
    const res = await stream(streamRequest(runChannel(matchId, hostId)));
    expect(res.status).toBe(401);
  });

  it("refuses the opponent's run before your own is over", async () => {
    const { guestId, hostCookie, matchId } = await runningMatch();
    const res = await stream(
      streamRequest(runChannel(matchId, guestId), hostCookie),
    );
    expect(res.status).toBe(403);
  });

  it("streams events published on the channel, and presence", async () => {
    const { hostId, hostCookie, matchId } = await runningMatch();
    const channel = runChannel(matchId, hostId);
    const abort = new AbortController();
    const res = await stream(streamRequest(channel, hostCookie, abort.signal));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const first = await readUntil(res.body!, (t) => t.includes(EVENTS.members));
    expect(first).toContain(`event: ${EVENTS.members}`);
    expect(first).toContain('"count":1');

    emit(channel, EVENTS.move, { seq: 1 });
    const next = await readUntil(res.body!, (t) => t.includes("event: move"));
    expect(next).toContain('data: {"seq":1}');

    abort.abort();
  });

  it("leaving drops the member count", async () => {
    const { hostId, hostCookie, matchId } = await runningMatch();
    const channel = runChannel(matchId, hostId);
    const abort = new AbortController();
    const res = await stream(streamRequest(channel, hostCookie, abort.signal));
    await readUntil(res.body!, (t) => t.includes(EVENTS.members));
    expect(memberCount(channel)).toBe(1);
    abort.abort();
    // The abort listener runs on the next tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(memberCount(channel)).toBe(0);
  });

  it("cleans up a stream aborted before it started", async () => {
    const { hostId, hostCookie, matchId } = await runningMatch();
    const channel = runChannel(matchId, hostId);
    const abort = new AbortController();
    abort.abort();
    await stream(streamRequest(channel, hostCookie, abort.signal));
    await new Promise((r) => setTimeout(r, 50));
    expect(memberCount(channel)).toBe(0);
  });
});

describe("POST /api/realtime/auth", () => {
  // Assumes the test environment has no PUSHER_* variables, which is true of
  // `.env` and of CI.
  it("does not exist without Pusher keys", async () => {
    const { hostId, hostCookie, matchId } = await runningMatch();
    const body = new URLSearchParams({
      socket_id: "1.1",
      channel_name: runChannel(matchId, hostId),
    });
    const res = await auth(
      new Request("http://localhost/api/realtime/auth", {
        method: "POST",
        headers: {
          cookie: hostCookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      }),
    );
    expect(res.status).toBe(404);
  });
});
