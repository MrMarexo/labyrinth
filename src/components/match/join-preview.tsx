"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { LobbyAction } from "~/components/match/lobby-action";
import { LockedBadge } from "~/components/match/lobby-list";
import { POLL_MS } from "~/components/realtime/poll";
import { useChannel } from "~/components/realtime/use-channel";
import { Link } from "~/components/link";
import { useRouter } from "~/i18n/navigation";
import { EVENTS, userChannel } from "~/match";
import { api, type RouterOutputs } from "~/trpc/react";

/** What a share link leads to once the match has left the lobby. */
export function MatchClosed() {
  const t = useTranslations("lobby");
  return (
    <div data-match-closed className="space-y-2">
      <p>{t("closed")}</p>
      <Link href="/matches">{t("backToLobby")}</Link>
    </div>
  );
}

/**
 * The join page's body: one waiting match and its action button. Watches the
 * caller's user channel so an accepted request takes them straight into the
 * match.
 */
export function JoinPreview({
  matchId,
  userId,
  initialData,
}: {
  matchId: string;
  userId: string;
  initialData: RouterOutputs["match"]["preview"];
}) {
  const t = useTranslations("lobby");
  const tm = useTranslations("matches");
  const router = useRouter();
  const utils = api.useUtils();

  const { data, isError } = api.match.preview.useQuery(
    { matchId },
    { initialData, retry: false },
  );

  // `get` succeeds only for a participant, so success means "seated". The
  // preview is refreshed after, so a match that closed for someone else
  // shows as closed.
  const check = async () => {
    const seated = await utils.match.get
      .fetch({ id: matchId }, { staleTime: 0 })
      .then(() => true)
      .catch(() => false);
    if (seated) router.push(`/matches/${matchId}`);
    else void utils.match.preview.invalidate({ matchId });
  };

  useChannel(userChannel(userId), {
    onEvent: (event) => {
      if (event === EVENTS.changed) void check();
    },
    onCatchUp: () => void check(),
  });
  // The fallback poll runs `check`, not a plain refetch: a seated caller's
  // preview is NOT_FOUND, which alone would read as "closed".
  const latestCheck = useRef(check);
  useEffect(() => {
    latestCheck.current = check;
  });
  useEffect(() => {
    const timer = setInterval(() => void latestCheck.current(), POLL_MS);
    return () => clearInterval(timer);
  }, []);

  if (isError) return <MatchClosed />;

  return (
    <div className="space-y-3">
      <p className="font-medium">
        {t("byCreator", { name: data.creatorName })}
      </p>
      <p className="text-muted text-sm">
        {tm("sizeAndGates", { cells: data.cellCount, gates: data.gateCount })}
      </p>
      {data.access === "locked" && <LockedBadge />}
      <LobbyAction
        matchId={matchId}
        access={data.access}
        request={data.request}
      />
    </div>
  );
}
