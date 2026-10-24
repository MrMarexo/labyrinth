"use client";

import { useTranslations } from "next-intl";

import { CancelMatch } from "~/components/match/cancel-match";
import { Link } from "~/components/link";
import { Link as LocaleLink } from "~/i18n/navigation";
import type { MatchStatus } from "~/match";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * Explicit map rather than building the key by string concatenation: adding
 * a status to the union without adding its copy here fails to compile,
 * rather than rendering a missing key at runtime.
 */
const STATUS_KEY = {
  awaiting_opponent: "statusAwaitingOpponent",
  drawing: "statusDrawing",
  running: "statusRunning",
  complete: "statusComplete",
  abandoned: "statusAbandoned",
} as const satisfies Record<MatchStatus, string>;

/**
 * The match that holds the caller, if any (`holdsPlayer`): a player is in
 * one at a time, so it decides whether they may start or join another.
 *
 * `active` is the server's verdict at fetch time, so the list is refetched
 * whenever a page using this mounts — a run that ended while the player was
 * elsewhere must not keep blocking them — and a deadline that has passed
 * since is checked here.
 */
export function useActiveMatch() {
  const { data, isPending } = api.match.list.useQuery(undefined, {
    refetchOnMount: "always",
  });
  const active =
    data?.find((m) => m.active && m.deadlineAt.getTime() > Date.now()) ?? null;
  return { active, isPending };
}

/**
 * The caller's match in progress, above everything else on the page so it is
 * not forgotten. It also stays in the list below.
 */
export function CurrentMatch() {
  const t = useTranslations("matches");
  const { active } = useActiveMatch();
  if (!active) return null;

  return (
    <section
      data-current-match={active.id}
      aria-labelledby="current-match-heading"
      className="border-accent flex flex-col gap-3 rounded border-2 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="space-y-1">
        <h2 id="current-match-heading" className="text-xl font-semibold">
          {t("currentHeading")}
        </h2>
        <p className="text-sm font-medium">{t(STATUS_KEY[active.status])}</p>
        <p className="text-muted text-sm">
          {t("sizeAndGates", {
            cells: active.cellCount,
            gates: active.gateCount,
          })}
        </p>
      </div>
      {/* The plain locale link: the shared `Link` fades its text colour on
          hover, which would fight the accent fill. */}
      <LocaleLink
        href={`/matches/${active.id}`}
        className="bg-accent text-on-accent rounded px-3 py-2 text-center text-sm hover:opacity-90"
      >
        {t("continue")}
      </LocaleLink>
    </section>
  );
}

export function MatchList() {
  const t = useTranslations("matches");
  const { data, isPending } = api.match.list.useQuery();

  // Branch on pending before treating empty data as empty, so a returning
  // player does not see "you have nothing yet" flash before their matches
  // arrive.
  if (isPending) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{t("yoursHeading")}</h2>
      {!data || data.length === 0 ? (
        <p className="text-muted text-sm">{t("empty")}</p>
      ) : (
        <MatchRows matches={data} />
      )}
    </section>
  );
}

function MatchRows({ matches }: { matches: RouterOutputs["match"]["list"] }) {
  const t = useTranslations("matches");

  return (
    <ul className="divide-border divide-y">
      {matches.map((m) => (
        <li
          key={m.id}
          data-match-row
          data-status={m.status}
          data-active={m.active ? "" : undefined}
          className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-1">
            <p className="text-sm font-medium">{t(STATUS_KEY[m.status])}</p>
            <p className="text-muted text-sm">
              {t("sizeAndGates", { cells: m.cellCount, gates: m.gateCount })}
            </p>
            {m.status === "awaiting_opponent" && <CancelMatch matchId={m.id} />}
          </div>
          <Link href={`/matches/${m.id}`}>{t("open")}</Link>
        </li>
      ))}
    </ul>
  );
}
