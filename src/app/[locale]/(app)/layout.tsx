import { hasLocale } from "next-intl";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { type ReactNode } from "react";

import { redirect } from "~/i18n/navigation";
import { locales } from "~/i18n/routing";
import { auth } from "~/server/auth";

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) notFound();

  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) redirect({ href: "/sign-in", locale });

  return <>{children}</>;
}
