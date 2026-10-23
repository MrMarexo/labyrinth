import {
  EVENTS,
  lobbyChannel,
  matchChannel,
  runChannel,
  userChannel,
} from "~/match";
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

/** "Refetch the lobby": same no-payload shape as `publishMatchChanged`. */
export function publishLobbyChanged(): Promise<void> {
  return publishSafely(lobbyChannel(), EVENTS.changed, {});
}

/** "Refetch your requests and matches": for the one user on this channel. */
export function publishUserChanged(userId: string): Promise<void> {
  return publishSafely(userChannel(userId), EVENTS.changed, {});
}
