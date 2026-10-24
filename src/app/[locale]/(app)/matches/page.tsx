import { useTranslations } from "next-intl";

import { LobbyList } from "~/components/match/lobby-list";
import { CurrentMatch, MatchList } from "~/components/match/match-list";
import { NewMatchForm } from "~/components/match/new-match-form";

export default function MatchesPage() {
  const t = useTranslations("matches");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-3xl font-bold">{t("title")}</h1>
      <CurrentMatch />
      <NewMatchForm />
      <LobbyList />
      <MatchList />
    </main>
  );
}
