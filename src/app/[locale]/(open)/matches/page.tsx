import { getTranslations } from "next-intl/server";

import { LobbyList } from "~/components/match/lobby-list";
import { CurrentMatch, MatchList } from "~/components/match/match-list";
import { NewMatchForm } from "~/components/match/new-match-form";
import { SignUpNotice } from "~/components/sign-up-notice";
import { api } from "~/trpc/server";

/**
 * Open to everyone. Only a member starts matches and keeps a history; a
 * guest still sees the match they are in, and a visitor only the lobby.
 */
export default async function MatchesPage() {
  const t = await getTranslations("matches");
  const viewer = await api.viewer.get();
  const member = viewer.kind === "member";

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-3xl">{t("title")}</h1>
      <CurrentMatch />
      {member ? <NewMatchForm /> : <SignUpNotice kind="matches" />}
      <LobbyList />
      {member && <MatchList />}
    </main>
  );
}
