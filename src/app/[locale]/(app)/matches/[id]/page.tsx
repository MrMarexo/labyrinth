import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { MatchLobby } from "~/components/match/match-lobby";
import { api } from "~/trpc/server";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // A match that does not exist and a match the caller is not part of must
  // land on the same page, for the same reason `api.match.get` itself
  // refuses to tell them apart — distinguishing the two here would leak
  // back the information the router deliberately withholds.
  const found = await api.match.get({ id }).catch(() => null);
  if (!found) notFound();

  const t = await getTranslations("lobby");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-3xl font-bold">{t("title")}</h1>
      <MatchLobby matchId={id} />
    </main>
  );
}
