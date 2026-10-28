"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Link } from "~/components/link";
import { useActiveMatch } from "~/components/match/match-list";
import { useViewer } from "~/components/viewer";
import { usePathname, useRouter } from "~/i18n/navigation";
import { signIn } from "~/lib/auth-client";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import type { MatchAccess } from "~/match";
import { api, type RouterOutputs } from "~/trpc/react";

type RequestState =
  RouterOutputs["match"]["lobby"]["matches"][number]["request"];

/** Why the lobby's buttons are disabled, shown once above them. */
export function LobbyBlockedNote() {
  const tm = useTranslations("matches");
  const { active } = useActiveMatch();
  if (!active) return null;
  return (
    <p data-lobby-blocked className="text-muted text-sm">
      {tm("lobbyBlocked")}
    </p>
  );
}

/**
 * The one button a waiting match offers someone else: Join an open match,
 * or Request / Withdraw / Declined for a locked one. Shared by the lobby row
 * and the join page, so `data-request-state` reads the same on both.
 *
 * A visitor's Join or Request first makes them a guest. Someone who already
 * is one, including after a guest sign-in whose join then failed, goes
 * straight to the mutation: a second anonymous sign-in is refused.
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
  const tg = useTranslations("guest");
  const tn = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname();
  const utils = api.useUtils();
  const { viewer } = useViewer();
  const visitor = viewer?.kind === "visitor";
  const [signingIn, setSigningIn] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  // In a match already: joining and asking are refused (one at a time), so
  // they are not offered. Withdrawing a request still is.
  const { active } = useActiveMatch();
  const blocked = active !== null;

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

  // The cache, not this render's `viewer`: another row's button may have
  // made the caller a guest a moment ago. It is set before the refetch, so
  // there is no window in which a guest reads as a visitor.
  const asGuest = async (mutate: () => void) => {
    setSignInFailed(false);
    const current = await utils.viewer.get.fetch();
    if (current.kind === "visitor") {
      setSigningIn(true);
      const { data, error } = await signIn.anonymous();
      setSigningIn(false);
      // Already a guest after all (signed in from another tab since the
      // cache was filled): carry on as one.
      const already =
        error?.code === "ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY";
      if (!already && (error ?? !data)) {
        setSignInFailed(true);
        return;
      }
      if (data) {
        utils.viewer.get.setData(undefined, {
          kind: "guest",
          number: data.user.name,
        });
      }
      void utils.viewer.get.invalidate();
      // Read as a visitor: `you` and the request state are the guest's now.
      refresh();
      // The header and the server-rendered page still show a visitor.
      router.refresh();
    }
    mutate();
  };

  const failed = [join, requestJoin, withdraw].find((m) => m.isError);
  const error = signInFailed
    ? { key: "errors.unknown" }
    : failed?.error
      ? resolveErrorKey(te, failed.error, "errors.unknown")
      : null;

  let action;
  if (access === "open") {
    action = (
      <button
        type="button"
        data-request-state="open"
        disabled={blocked || signingIn || join.isPending}
        onClick={() => void asGuest(() => join.mutate({ matchId }))}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
      >
        {signingIn || join.isPending
          ? tm("joining")
          : visitor
            ? tg("joinAsGuest")
            : tm("join")}
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
        disabled={blocked || signingIn || requestJoin.isPending}
        onClick={() => void asGuest(() => requestJoin.mutate({ matchId }))}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
      >
        {signingIn || requestJoin.isPending
          ? t("requesting")
          : visitor
            ? tg("requestAsGuest")
            : t("requestJoin")}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      {visitor ? (
        <div className="flex items-center gap-3">
          {action}
          <Link
            href={{ pathname: "/sign-in", query: { next: pathname } }}
            className="text-sm"
          >
            {tn("signIn")}
          </Link>
        </div>
      ) : (
        action
      )}
      {error && (
        <p role="alert" data-lobby-error className="text-danger text-sm">
          {te(error.key as never, error.params as never)}
        </p>
      )}
    </div>
  );
}
