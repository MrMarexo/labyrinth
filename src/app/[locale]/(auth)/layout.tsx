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
  // on the sign-in or sign-up form.
  const session = await getSession(await headers());

  if (session) redirect({ href: "/", locale });

  return <>{children}</>;
}
