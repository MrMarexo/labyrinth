"use client";

import { useChannel } from "~/components/realtime/use-channel";
import { MatchLobby } from "~/components/match/match-lobby";
import { MatchResult } from "~/components/run/match-result";
import { RunView } from "~/components/run/run-view";
import { EVENTS, isTerminal } from "~/match";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * The fallback for a dropped connection: pings on the match channel are the
 * notification (spec §8), and this catches what a lost connection missed.
 */
const POLL_MS = 60_000;

/**
 * One URL for the whole match (spec §10.3.1): the lobby until the runs
 * unlock, the run until the match ends, then the result. A match that ended
 * before both mazes were in never had a run to show a result for, so it
 * stays on the lobby, which already explains an abandoned match.
 */
export function MatchScreen({
  matchId,
  initialData,
}: {
  matchId: string;
  initialData: RouterOutputs["match"]["get"];
}) {
  const { data } = api.match.get.useQuery(
    { id: matchId },
    {
      initialData,
      refetchInterval: (query) =>
        query.state.data && !isTerminal(query.state.data.status)
          ? POLL_MS
          : false,
    },
  );

  const utils = api.useUtils();
  const refresh = () => {
    void utils.match.get.invalidate({ id: matchId });
    void utils.run.get.invalidate({ matchId });
  };
  useChannel(data.channels.match, {
    onEvent: (event) => {
      if (event === EVENTS.changed) refresh();
    },
    onReconnect: refresh,
  });

  const ran = data.you.hasSubmitted && (data.opponent?.hasSubmitted ?? false);

  if (data.status === "running") {
    return (
      <RunView
        matchId={matchId}
        opponentName={data.opponent?.displayName ?? ""}
        deadlineAt={data.deadlineAt}
        runChannel={data.channels.yourRun}
      />
    );
  }
  if (isTerminal(data.status) && ran) return <MatchResult matchId={matchId} />;
  return <MatchLobby matchId={matchId} initialData={data} />;
}
