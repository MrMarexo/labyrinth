"use client";

import { useTranslations } from "next-intl";

import { ResultMaze } from "~/components/run/result-maze";
import { Link } from "~/i18n/navigation";
import { formatElapsed } from "~/lib/format-elapsed";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { api, type RouterOutputs } from "~/trpc/react";

type Result = RouterOutputs["run"]["result"];
type Score = Result["you"];

export function MatchResult({ matchId }: { matchId: string }) {
  const t = useTranslations("result");
  const te = useTranslations();

  const { data, error, isPending } = api.run.result.useQuery({ matchId });

  if (isPending && !error) return null;
  if (error) {
    const issue = resolveErrorKey(te, error, "errors.unknown");
    return <p role="alert">{te(issue.key as never, issue.params as never)}</p>;
  }

  const { outcome, reason, gaveUpBy, decidedBy, you, opponent, mazes } = data;
  const name = opponent?.displayName ?? "";

  let reasonText: string;
  switch (reason) {
    case "treasure":
      reasonText = t("reasonTreasure");
      break;
    case "tie":
      reasonText = t("reasonTie");
      break;
    case "gaveUp":
      reasonText =
        gaveUpBy === "you"
          ? t("reasonYouGaveUp")
          : t("reasonOpponentGaveUp", { name });
      break;
    case "timeout":
      reasonText = you.timedOut
        ? t("reasonYouTimedOut")
        : t("reasonOpponentTimedOut", { name });
      break;
    case "abandoned":
      reasonText = you.timedOut
        ? t("reasonAbandonedYou")
        : opponent?.timedOut
          ? t("reasonAbandonedOpponent", { name })
          : t("reasonAbandoned");
      break;
  }

  const decidedByText =
    decidedBy === "penalties"
      ? t("decidedByPenalties")
      : decidedBy === "moves"
        ? t("decidedByMoves")
        : decidedBy === "time"
          ? t("decidedByTime")
          : null;

  const rows: { who: "you" | "opponent"; label: string; score: Score }[] = [
    { who: "you", label: t("you"), score: you },
  ];
  if (opponent) {
    rows.push({
      who: "opponent",
      label: opponent.displayName,
      score: opponent,
    });
  }
  const bold = (column: "penalties" | "moves" | "time") =>
    decidedBy === column ? "font-bold" : undefined;

  return (
    <section
      data-match-result
      data-outcome={outcome}
      data-reason={reason}
      className="space-y-6"
    >
      <div className="space-y-2">
        <h2 className="text-3xl font-bold">{t(outcome)}</h2>
        <p>{reasonText}</p>
        {decidedByText && <p data-decided-by={decidedBy}>{decidedByText}</p>}
      </div>

      <table className="text-left">
        <caption className="mb-2 text-left font-medium">
          {t("scoreHeading")}
        </caption>
        <thead>
          <tr>
            <td />
            <th scope="col" className="pr-6">
              {t("penalties")}
            </th>
            <th scope="col" className="pr-6">
              {t("moves")}
            </th>
            <th scope="col">{t("time")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ who, label, score }) => (
            <tr key={who} data-score={who}>
              <th scope="row" className="pr-6">
                {label}
              </th>
              <td
                data-penalties={score.penalties}
                className={`pr-6 ${bold("penalties") ?? ""}`}
              >
                {score.penalties}
              </td>
              <td className={`pr-6 ${bold("moves") ?? ""}`}>{score.moves}</td>
              <td className={bold("time")}>
                {score.elapsedMs === null
                  ? t("didNotFinish")
                  : formatElapsed(score.elapsedMs, {
                      tenths: decidedBy === "time",
                    })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {mazes && (
        <div className="grid gap-6 md:grid-cols-2">
          <ResultMaze
            which="theirs"
            maze={mazes.theirs.maze}
            path={mazes.theirs.path}
            label={t("theirMaze", { name })}
          />
          <ResultMaze
            which="yours"
            maze={mazes.yours.maze}
            path={mazes.yours.path}
            label={t("yourMaze", { name })}
          />
        </div>
      )}

      {mazes && (
        <div className="flex flex-wrap gap-4">
          <Link
            href={`/matches/${matchId}/watch?run=mine`}
            data-replay-link="mine"
            className="text-accent underline"
          >
            {t("replayMine")}
          </Link>
          <Link
            href={`/matches/${matchId}/watch?run=opponent`}
            data-replay-link="opponent"
            className="text-accent underline"
          >
            {t("replayTheirs", { name })}
          </Link>
        </div>
      )}

      <Link href="/matches" className="underline">
        {t("backToMatches")}
      </Link>
    </section>
  );
}
