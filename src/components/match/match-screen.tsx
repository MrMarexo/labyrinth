"use client";

import { useState } from "react";

import { POLL_MS } from "~/components/realtime/poll";
import { useChannel } from "~/components/realtime/use-channel";
import { MatchLobby } from "~/components/match/match-lobby";
import { FinishPopup } from "~/components/run/finish-popup";
import { MatchResult } from "~/components/run/match-result";
import { RunView, type Finish } from "~/components/run/run-view";
import { EVENTS, isTerminal } from "~/match";
import { api, type RouterOutputs } from "~/trpc/react";

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
    // The creator's request list rides on this channel too; a second
    // subscription to it from `JoinRequests` would break this one.
    void utils.match.requests.invalidate({ matchId });
  };
  useChannel(data.channels.match, {
    onEvent: (event) => {
      if (event === EVENTS.changed) refresh();
    },
    onCatchUp: refresh,
  });

  const ran = data.you.hasSubmitted && (data.opponent?.hasSubmitted ?? false);

  // Held here, not in the run view: the finishing move can complete the
  // match, which swaps the run view for the result underneath the popup.
  const [finish, setFinish] = useState<Finish | null>(null);

  let screen;
  if (data.status === "running") {
    screen = (
      <RunView
        matchId={matchId}
        opponentName={data.opponent?.displayName ?? ""}
        deadlineAt={data.deadlineAt}
        runChannel={data.channels.yourRun}
        onFinish={setFinish}
      />
    );
  } else if (isTerminal(data.status) && ran) {
    screen = <MatchResult matchId={matchId} />;
  } else {
    screen = <MatchLobby matchId={matchId} initialData={data} />;
  }

  return (
    <>
      {screen}
      {finish && (
        <FinishPopup
          matchId={matchId}
          finish={finish}
          ready={finish.matchOver || isTerminal(data.status)}
          onClose={() => setFinish(null)}
        />
      )}
    </>
  );
}
