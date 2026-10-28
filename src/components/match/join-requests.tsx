"use client";

import { useTranslations } from "next-intl";

import { useTimeAgo } from "~/components/match/lobby-list";
import { usePlayerName } from "~/components/player-name";
import { POLL_MS } from "~/components/realtime/poll";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { api } from "~/trpc/react";

/**
 * The creator's pending requests for a locked match. Kept live by
 * `MatchScreen`, which already holds the match channel and invalidates this
 * query on its pings; subscribing here as well would break that channel
 * (see `useChannel`).
 */
export function JoinRequests({ matchId }: { matchId: string }) {
  const t = useTranslations("lobby");
  const playerName = usePlayerName();
  const te = useTranslations();
  const ago = useTimeAgo();
  const utils = api.useUtils();

  const { data, isPending } = api.match.requests.useQuery(
    { matchId },
    { refetchInterval: POLL_MS },
  );

  const refresh = () => {
    void utils.match.requests.invalidate({ matchId });
    void utils.match.get.invalidate({ id: matchId });
  };
  const accept = api.match.acceptRequest.useMutation({ onSettled: refresh });
  const decline = api.match.declineRequest.useMutation({ onSettled: refresh });

  const failed = [accept, decline].find((m) => m.isError);
  const error = failed?.error
    ? resolveErrorKey(te, failed.error, "errors.unknown")
    : null;
  const busy = accept.isPending || decline.isPending;

  if (isPending) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-xl">{t("requestsHeading")}</h2>
      {!data || data.length === 0 ? (
        <p className="text-muted text-sm">{t("noRequests")}</p>
      ) : (
        <ul className="divide-border divide-y">
          {data.map((r) => (
            <li
              key={r.userId}
              data-join-request={r.userId}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <p className="text-sm">{playerName(r)}</p>
                <p className="text-muted text-sm">
                  {t("askedAgo", {
                    when: ago(r.createdAt),
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("acceptName", { name: playerName(r) })}
                  onClick={() => accept.mutate({ matchId, userId: r.userId })}
                  className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
                >
                  {t("accept")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("declineName", { name: playerName(r) })}
                  onClick={() => decline.mutate({ matchId, userId: r.userId })}
                  className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
                >
                  {t("decline")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" data-request-error className="text-danger text-sm">
          {te(error.key as never, error.params as never)}
        </p>
      )}
    </section>
  );
}
