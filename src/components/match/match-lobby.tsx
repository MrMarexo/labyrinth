"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { MazePicker } from "~/components/match/maze-picker";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { isTerminal } from "~/match";
import { api, type RouterOutputs } from "~/trpc/react";

export type MatchLobbyProps = {
  matchId: string;
  // Fetched server-side as the page's own 404 check (a match that does not
  // exist and one the caller is not in look identical — see
  // `matches/[id]/page.tsx`). Seeding `useQuery` with it means this
  // component never renders `null` waiting on a fetch the server already
  // did, and the browser never repeats that round trip.
  initialData: RouterOutputs["match"]["get"];
};

export function MatchLobby({ matchId, initialData }: MatchLobbyProps) {
  const t = useTranslations("lobby");
  const tm = useTranslations("matches");
  const te = useTranslations();
  const format = useFormatter();
  const utils = api.useUtils();

  const { data, isPending } = api.match.get.useQuery(
    { id: matchId },
    { initialData },
  );
  // Same query key `MazePicker` reads below, so once the picker is showing
  // this is a cache read, not a second request — it exists here only to
  // look up the chosen maze's name for the confirmation sentence. Gated on
  // the same condition as the picker itself, so it is not fetched at all
  // for a match in any other status.
  const { data: mazes } = api.match.eligibleMazes.useQuery(
    { matchId },
    { enabled: data?.status === "drawing" && !data.you.hasSubmitted },
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const submit = api.match.submitMaze.useMutation({
    onSuccess: () => {
      setConfirming(false);
      void utils.match.get.invalidate({ id: matchId });
      void utils.match.list.invalidate();
    },
  });
  const submitError = submit.isError
    ? resolveErrorKey(te, submit.error, "errors.unknown")
    : null;

  // The page already turned any real failure into notFound() before this
  // ever mounted, so there is nothing to branch on here besides pending.
  if (isPending) return null;
  if (!data) return null;

  let statusText: string;
  if (data.status === "awaiting_opponent") {
    statusText = t("waitingForOpponent");
  } else if (data.status === "running") {
    statusText = `${t("bothIn")} ${t("runsComingSoon")}`;
  } else if (data.status === "abandoned") {
    statusText = t("abandoned");
  } else {
    // "drawing", and "complete" — the latter is unreachable in Phase 3 (see
    // src/server/match/sweep.ts), but when it does become reachable both
    // players will necessarily have submitted already, so this combination
    // still reads correctly until a dedicated winner sentence exists.
    const yours = data.you.hasSubmitted ? t("youSubmitted") : t("youDraw");
    const theirs = data.opponent?.hasSubmitted
      ? t("opponentSubmitted")
      : t("opponentDrawing");
    statusText = `${yours} ${theirs}`;
  }

  const selectedMaze = mazes?.find((m) => m.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <p data-match-status={data.status}>{statusText}</p>

      {data.status === "awaiting_opponent" && (
        <p data-match-code={data.code} className="text-sm">
          {tm("shareCode", { code: data.code })}
        </p>
      )}

      <span data-you-submitted={String(data.you.hasSubmitted)} />
      <span
        data-opponent-submitted={String(data.opponent?.hasSubmitted ?? false)}
      />

      {!isTerminal(data.status) && (
        <p className="text-muted text-sm">
          {t("deadline", {
            when: format.dateTime(data.deadlineAt, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </p>
      )}

      {data.status === "drawing" && !data.you.hasSubmitted && (
        <div className="space-y-3">
          <MazePicker
            matchId={matchId}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setConfirming(false);
            }}
          />

          {confirming ? (
            <div className="space-y-2">
              <p>{t("confirmSubmit", { name: selectedMaze?.name ?? "" })}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={submit.isPending}
                  onClick={() => {
                    if (!selected) return;
                    submit.mutate({ matchId, mazeId: selected });
                  }}
                  className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
                >
                  {submit.isPending ? t("submitting") : t("confirmYes")}
                </button>
                <button
                  type="button"
                  disabled={submit.isPending}
                  onClick={() => setConfirming(false)}
                  className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
                >
                  {t("confirmNo")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!selected}
              onClick={() => setConfirming(true)}
              className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
            >
              {t("submit")}
            </button>
          )}

          {submitError && (
            <p role="alert" data-submit-error className="text-danger text-sm">
              {te(submitError.key as never, submitError.params as never)}
            </p>
          )}
        </div>
      )}

      {data.you.hasForfeited && <p>{t("forfeited")}</p>}
      {data.opponent?.hasForfeited && <p>{t("opponentForfeited")}</p>}
    </div>
  );
}
