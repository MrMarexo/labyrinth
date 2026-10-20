import { maySubscribe, parseChannel, type WatchFacts } from "~/match";
import { participantRows, type DbClient } from "~/server/match/access";
import type { MatchRow, PlayerRow } from "~/server/match/situation";

export function watchFactsFor(
  row: MatchRow,
  players: readonly PlayerRow[],
  userId: string,
): WatchFacts {
  const you = players.find((p) => p.userId === userId)!;
  const them = players.find((p) => p.userId !== userId);
  return {
    status: row.status,
    you: {
      userId: you.userId,
      submittedAt: you.submittedAt,
      finishedAt: you.finishedAt,
    },
    opponent: them
      ? { userId: them.userId, submittedAt: them.submittedAt }
      : null,
  };
}

/**
 * Spec §8.1: the only place a subscription is decided. The Pusher auth
 * endpoint and the local stream both call this, so the two transports
 * cannot disagree about who may listen.
 */
export async function canSubscribe(
  db: DbClient,
  userId: string,
  channelName: string,
): Promise<boolean> {
  const channel = parseChannel(channelName);
  if (!channel) return false;
  const found = await participantRows(db, channel.matchId, userId);
  if (!found) return false;
  return maySubscribe(channel, watchFactsFor(found.row, found.players, userId));
}
