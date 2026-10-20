import { EVENTS, matchChannel, runChannel } from "~/match";
import type { LoggedMove } from "~/maze";

import { publishSafely } from "./index";

/** One newly committed move, exactly as stored (spec §8). */
export function publishMove(
  matchId: string,
  runnerId: string,
  move: LoggedMove,
): Promise<void> {
  return publishSafely(runChannel(matchId, runnerId), EVENTS.move, move);
}

/** "Refetch the match": no payload, so the channel can disclose nothing. */
export function publishMatchChanged(matchId: string): Promise<void> {
  return publishSafely(matchChannel(matchId), EVENTS.changed, {});
}
