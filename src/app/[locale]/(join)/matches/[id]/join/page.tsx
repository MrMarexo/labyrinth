import { hasLocale } from "next-intl";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { redirect } from "~/i18n/navigation";
import { locales } from "~/i18n/routing";
import { getSession } from "~/server/auth";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(locales, locale)) notFound();

  const session = await getSession(await headers());

  if (!session) {
    redirect({
      href: { pathname: "/sign-in", query: { next: `/matches/${id}/join` } },
      locale,
    });
  }

  return null;
}
