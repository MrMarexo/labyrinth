"use client";

import { Lock } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { LobbyAction, LobbyBlockedNote } from "~/components/match/lobby-action";
import { usePlayerName } from "~/components/player-name";
import { POLL_MS } from "~/components/realtime/poll";
import { useChannel } from "~/components/realtime/use-channel";
import { useRouter } from "~/i18n/navigation";
import { EVENTS, lobbyChannel, userChannel } from "~/match";
import { api } from "~/trpc/react";

/** The lock icon is never the only signal: the label says it too. */
export function LockedBadge() {
  const t = useTranslations("lobby");
  return (
    <span data-locked className="text-muted flex items-center gap-1 text-sm">
      <Lock aria-hidden="true" className="size-3.5" />
      {t("locked")}
    </span>
  );
}

/**
 * "5 minutes ago", ticking. A time a little after the client's clock (a row
 * fetched just after `now` last ticked, or plain clock skew) reads "now"
 * rather than "in 2 seconds".
 */
export function useTimeAgo(): (date: Date) => string {
  const format = useFormatter();
  const now = useNow({ updateInterval: 10_000 });
  return (date) =>
    format.relativeTime(date, Math.max(now.getTime(), date.getTime()));
}

/** Everyone else's waiting matches, kept live by the lobby channel. */
export function LobbyList() {
  const t = useTranslations("lobby");
  const playerName = usePlayerName();
  const tm = useTranslations("matches");
  const ago = useTimeAgo();
  const router = useRouter();
  const utils = api.useUtils();

  const { data, isPending } = api.match.lobby.useQuery(undefined, {
    refetchInterval: POLL_MS,
  });

  // Every match the caller has asked to join while on this page. Accepting
  // one removes it from the lobby (the lobby ping may even land first), so
  // ids are only ever added: an id is acted on only once `match.list` shows
  // the caller seated in it, which a withdrawn request never does.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const m of data?.matches ?? []) {
      if (m.request === "pending") asked.current.add(m.id);
    }
  }, [data]);

  const refreshLobby = () => {
    void utils.match.lobby.invalidate();
    // A lobby ping can also mean the caller's own match was joined.
    void utils.match.list.invalidate();
  };
  const refreshMine = async () => {
    void utils.match.lobby.invalidate();
    if (asked.current.size === 0) return;
    await utils.match.list.invalidate();
    const mine = await utils.match.list.fetch();
    const seated = mine.find((m) => asked.current.has(m.id));
    if (seated) router.push(`/matches/${seated.id}`);
  };

  useChannel(lobbyChannel(), {
    onEvent: (event) => {
      if (event === EVENTS.changed) refreshLobby();
    },
    onCatchUp: refreshLobby,
  });
  useChannel(data?.you ? userChannel(data.you) : null, {
    onEvent: (event) => {
      if (event === EVENTS.changed) void refreshMine();
    },
    onCatchUp: () => void refreshMine(),
  });

  if (isPending) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{t("heading")}</h2>
      <LobbyBlockedNote />
      {!data || data.matches.length === 0 ? (
        <p data-lobby-empty className="text-muted text-sm">
          {t("empty")}
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {data.matches.map((m) => (
            <li
              key={m.id}
              data-lobby-match={m.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {playerName({ name: m.creatorName, guest: m.creatorGuest })}
                </p>
                <p className="text-muted text-sm">
                  {tm("sizeAndGates", {
                    cells: m.cellCount,
                    gates: m.gateCount,
                  })}
                </p>
                <p className="text-muted text-sm">
                  {t("createdAgo", {
                    when: ago(m.createdAt),
                  })}
                </p>
                {m.access === "locked" && <LockedBadge />}
              </div>
              <LobbyAction
                matchId={m.id}
                access={m.access}
                request={m.request}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
