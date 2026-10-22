import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";

import {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  gatedMazeDraft,
} from "../fixtures/maze";

export async function signedIn() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  const ctx = await createTRPCContext({ headers: new Headers({ cookie }) });
  return Object.assign(ctx, { cookie });
}

const settings = {
  cellCount: GATED_MAZE_CELL_COUNT,
  gateCount: GATED_MAZE_GATE_COUNT,
} as const;

async function submitGated(
  caller: ReturnType<typeof createCaller>,
  matchId: string,
) {
  const created = await caller.maze.createDraft({ name: "Gated", ...settings });
  await caller.maze.saveDraft({
    id: created.id,
    data: gatedMazeDraft(),
    expectedVersion: 0,
  });
  await caller.match.submitMaze({ matchId, mazeId: created.id });
}

/**
 * Two players in a `running` match, each solving the other's copy of the
 * gated seed — so `GATED_MAZE_ROUTE` solves the run for either of them.
 */
export async function runningMatch() {
  const hostCtx = await signedIn();
  const guestCtx = await signedIn();
  const host = createCaller(hostCtx);
  const guest = createCaller(guestCtx);

  const created = await host.match.create(settings);
  await guest.match.join({ code: created.code });
  await submitGated(host, created.id);
  await submitGated(guest, created.id);

  return {
    host,
    guest,
    hostId: hostCtx.session!.user.id,
    guestId: guestCtx.session!.user.id,
    hostCookie: hostCtx.cookie,
    guestCookie: guestCtx.cookie,
    matchId: created.id,
  };
}
