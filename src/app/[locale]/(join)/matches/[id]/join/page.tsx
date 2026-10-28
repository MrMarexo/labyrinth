import { TRPCError } from "@trpc/server";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { JoinPreview, MatchClosed } from "~/components/match/join-preview";
import { redirect } from "~/i18n/navigation";
import { locales } from "~/i18n/routing";
import { getSession } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(locales, locale)) notFound();

  // A visitor sees the preview too: joining makes them a guest.
  const session = await getSession(await headers());

  // Checked before `preview`, which is NOT_FOUND once the match has left the
  // lobby: a participant, in any status, belongs on the match itself.
  if (session) {
    const found = await api.match.get({ id }).catch(() => null);
    if (found) return redirect({ href: `/matches/${id}`, locale });
  }

  const preview = await api.match.preview({ matchId: id }).catch((error) => {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") return null;
    throw error;
  });

  const t = await getTranslations("lobby");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-3xl font-bold">{t("joinTitle")}</h1>
      {preview ? (
        <JoinPreview
          matchId={id}
          userId={session?.user.id ?? null}
          initialData={preview}
        />
      ) : (
        <MatchClosed />
      )}
    </main>
  );
}
