import "~/styles/globals.css";

import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { type Metadata } from "next";
import { VT323 } from "next/font/google";
import { notFound } from "next/navigation";
import { type ReactNode } from "react";

import { SiteHeader } from "~/components/site-header";
import { ThemeScript } from "~/components/theme-script";
import { routing } from "~/i18n/routing";
import { TRPCReactProvider } from "~/trpc/react";

const vt323 = VT323({
  weight: "400",
  // latin-ext carries Slovak's diacritics.
  subsets: ["latin", "latin-ext"],
  variable: "--font-vt323",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "app" });

  return {
    title: t("name"),
    description: t("tagline"),
    icons: [{ rel: "icon", url: "/favicon.ico" }],
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <html lang={locale} className={vt323.variable} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="bg-bg text-fg min-h-dvh">
        <NextIntlClientProvider>
          <TRPCReactProvider>
            <SiteHeader />
            {children}
          </TRPCReactProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
