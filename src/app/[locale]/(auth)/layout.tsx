import { hasLocale } from "next-intl";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { type ReactNode } from "react";

import { redirect } from "~/i18n/navigation";
import { locales } from "~/i18n/routing";
import { getSession } from "~/server/auth";

export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) notFound();

  // The mirror of the (app) guard: someone already signed in has no business
  // on the sign-in or sign-up form. A guest does: signing up or in is how
  // they keep their game.
  const session = await getSession(await headers());

  if (session && !session.user.isAnonymous) redirect({ href: "/", locale });

  return <>{children}</>;
}
