import { notFound } from "next/navigation";

import { WatchView } from "~/components/watch/watch-view";
import { api } from "~/trpc/server";

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { id } = await params;
  const { run } = await searchParams;
  const whose = run === "mine" ? "mine" : "opponent";

  // Same 404 for an outsider as for a match that does not exist, as on the
  // match page.
  const found = await api.match.get({ id }).catch(() => null);
  if (!found) notFound();

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <WatchView
        matchId={id}
        whose={whose}
        matchChannel={found.channels.match}
      />
    </main>
  );
}
