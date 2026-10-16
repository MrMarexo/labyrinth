"use client";

import { MatchLobby } from "~/components/match/match-lobby";
import { MatchResult } from "~/components/run/match-result";
import { RunView } from "~/components/run/run-view";
import { isTerminal } from "~/match";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * How often an open run checks whether the match ended under it — the
 * opponent gave up, or finished second. It is the whole notification until
 * the realtime layer exists (spec §9.2, Phase 5).
 */
const POLL_MS = 20_000;

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
        query.state.data?.status === "running" ? POLL_MS : false,
    },
  );

  const ran = data.you.hasSubmitted && (data.opponent?.hasSubmitted ?? false);

  if (data.status === "running") {
    return (
      <RunView
        matchId={matchId}
        opponentName={data.opponent?.displayName ?? ""}
        deadlineAt={data.deadlineAt}
      />
    );
  }
  if (isTerminal(data.status) && ran) return <MatchResult matchId={matchId} />;
  return <MatchLobby matchId={matchId} initialData={data} />;
}
