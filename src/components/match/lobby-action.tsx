"use client";

import { useTranslations } from "next-intl";

import { useRouter } from "~/i18n/navigation";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import type { MatchAccess } from "~/match";
import { api, type RouterOutputs } from "~/trpc/react";

type RequestState =
  RouterOutputs["match"]["lobby"]["matches"][number]["request"];

/**
 * The one button a waiting match offers someone else: Join an open match,
 * or Request / Withdraw / Declined for a locked one. Shared by the lobby row
 * and the join page, so `data-request-state` reads the same on both.
 */
export function LobbyAction({
  matchId,
  access,
  request,
}: {
  matchId: string;
  access: MatchAccess;
  request: RequestState;
}) {
  const t = useTranslations("lobby");
  const tm = useTranslations("matches");
  const te = useTranslations();
  const router = useRouter();
  const utils = api.useUtils();

  // Both views read the request state from their own query; refreshing both
  // is cheaper than knowing which one this button sits in.
  const refresh = () => {
    void utils.match.lobby.invalidate();
    void utils.match.preview.invalidate({ matchId });
  };

  const join = api.match.join.useMutation({
    onSuccess: ({ id }) => {
      void utils.match.list.invalidate();
      router.push(`/matches/${id}`);
    },
  });
  const requestJoin = api.match.requestJoin.useMutation({ onSettled: refresh });
  const withdraw = api.match.withdrawRequest.useMutation({
    onSettled: refresh,
  });

  const failed = [join, requestJoin, withdraw].find((m) => m.isError);
  const error = failed?.error
    ? resolveErrorKey(te, failed.error, "errors.unknown")
    : null;

  let action;
  if (access === "open") {
    action = (
      <button
        type="button"
        data-request-state="open"
        disabled={join.isPending}
        onClick={() => join.mutate({ matchId })}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
      >
        {join.isPending ? tm("joining") : tm("join")}
      </button>
    );
  } else if (request === "pending") {
    action = (
      <div className="flex items-center gap-2">
        <span className="text-muted text-sm">{t("requested")}</span>
        <button
          type="button"
          data-request-state="pending"
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate({ matchId })}
          className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
        >
          {withdraw.isPending ? t("withdrawing") : t("withdraw")}
        </button>
      </div>
    );
  } else if (request === "declined") {
    action = (
      <button
        type="button"
        data-request-state="declined"
        disabled
        className="border-border-strong text-muted rounded border px-3 py-2 text-sm"
      >
        {t("declined")}
      </button>
    );
  } else {
    action = (
      <button
        type="button"
        data-request-state="none"
        disabled={requestJoin.isPending}
        onClick={() => requestJoin.mutate({ matchId })}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
      >
        {requestJoin.isPending ? t("requesting") : t("requestJoin")}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      {action}
      {error && (
        <p role="alert" data-lobby-error className="text-danger text-sm">
          {te(error.key as never, error.params as never)}
        </p>
      )}
    </div>
  );
}
