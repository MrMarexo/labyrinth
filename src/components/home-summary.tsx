"use client";

import { useTranslations } from "next-intl";

import { CurrentMatch } from "~/components/match/match-list";
import { Link as LocaleLink } from "~/i18n/navigation";
import { MAZE_LIMIT, savedCount } from "~/maze";
import { api } from "~/trpc/react";

/**
 * A member's home page: the match that holds the player, if any, ways to
 * start something new, and a count of what they have. The counts come from
 * the same queries the matches and labyrinths pages use, so moving on to
 * either costs no extra request. The page renders it for members only.
 */
export function HomeSummary() {
  const t = useTranslations("home");

  return (
    <div data-home-summary className="space-y-6">
      <CurrentMatch />
      <nav aria-label={t("startHeading")} className="flex flex-wrap gap-3">
        {/* The plain locale link: the shared `Link` fades its text colour on
            hover, which would fight the border style. */}
        <LocaleLink
          href="/matches"
          className="border-border-strong hover:border-fg rounded border px-3 py-2 text-sm"
        >
          {t("newMatch")}
        </LocaleLink>
        <LocaleLink
          href="/labyrinths"
          className="border-border-strong hover:border-fg rounded border px-3 py-2 text-sm"
        >
          {t("newLabyrinth")}
        </LocaleLink>
      </nav>
      <div className="grid gap-4 sm:grid-cols-2">
        <MatchStats />
        <LabyrinthStats />
      </div>
    </div>
  );
}

/**
 * Played means reached `complete`. An `abandoned` match was never decided
 * (invariant 7) and is often one nobody joined, so it counts as neither.
 */
function MatchStats() {
  const t = useTranslations("home");
  const { data } = api.match.list.useQuery();
  if (!data) return null;

  const played = data.filter((m) => m.status === "complete");
  const inProgress = data.filter(
    (m) => m.status !== "complete" && m.status !== "abandoned",
  );
  return (
    <StatCard
      heading={t("matchesHeading")}
      stats={[
        {
          key: "inProgress",
          label: t("inProgress"),
          value: inProgress.length,
        },
        { key: "played", label: t("played"), value: played.length },
        {
          key: "won",
          label: t("won"),
          value: played.filter((m) => m.won).length,
        },
      ]}
    />
  );
}

function LabyrinthStats() {
  const t = useTranslations("home");
  const { data } = api.maze.list.useQuery();
  if (!data) return null;

  return (
    <StatCard
      heading={t("labyrinthsHeading")}
      stats={[
        {
          key: "saved",
          label: t("saved"),
          value: t("savedOf", { count: savedCount(data), limit: MAZE_LIMIT }),
        },
        {
          key: "ready",
          label: t("ready"),
          value: data.filter((m) => m.state === "ready").length,
        },
        {
          key: "unfinished",
          label: t("unfinished"),
          // The concept being drawn, and any legacy draft that never validated.
          value: data.filter(
            (m) => m.state === "concept" || m.state === "draft",
          ).length,
        },
      ]}
    />
  );
}

function StatCard({
  heading,
  stats,
}: {
  heading: string;
  stats: { key: string; label: string; value: number | string }[];
}) {
  return (
    <section className="border-border space-y-3 rounded border p-4">
      <h2 className="text-xl font-semibold">{heading}</h2>
      <dl className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.key} data-stat={s.key}>
            <dt className="text-muted text-sm">{s.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
