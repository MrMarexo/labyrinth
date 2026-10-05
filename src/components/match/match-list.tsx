"use client";

import { useTranslations } from "next-intl";

import { Link } from "~/i18n/navigation";
import type { MatchStatus } from "~/match";
import { api } from "~/trpc/react";

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

export function MatchList() {
  const t = useTranslations("matches");
  const { data, isPending } = api.match.list.useQuery();

  // Branch on pending before treating empty data as empty, so a returning
  // player does not see "you have nothing yet" flash before their matches
  // arrive.
  if (isPending) return null;
  if (!data || data.length === 0) {
    return <p className="text-muted text-sm">{t("empty")}</p>;
  }

  return (
    <ul className="divide-border divide-y">
      {data.map((m) => (
        <li
          key={m.id}
          data-match-row
          data-status={m.status}
          className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-1">
            <p className="text-sm font-medium">{t(STATUS_KEY[m.status])}</p>
            <p className="text-muted text-sm">
              {t("sizeAndGates", { cells: m.cellCount, gates: m.gateCount })}
            </p>
            {m.status === "awaiting_opponent" && (
              <p data-match-code={m.code} className="text-sm">
                {t("shareCode", { code: m.code })}
              </p>
            )}
          </div>
          <Link href={`/matches/${m.id}`} className="underline">
            {t("open")}
          </Link>
        </li>
      ))}
    </ul>
  );
}
