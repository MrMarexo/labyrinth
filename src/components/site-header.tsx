import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "~/components/locale-switcher";
import { SignOutButton } from "~/components/sign-out-button";
import { ThemeToggle } from "~/components/theme-toggle";
import { Link } from "~/i18n/navigation";
import { auth } from "~/server/auth";

export async function SiteHeader() {
  const t = await getTranslations();
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <header className="border-border flex items-center justify-between border-b px-4 py-3">
      <Link href="/" className="font-semibold">
        {t("app.name")}
      </Link>
      <div className="flex items-center gap-3">
        <LocaleSwitcher />
        <ThemeToggle />
        {session ? (
          <SignOutButton />
        ) : (
          <>
            <Link href="/sign-in" className="text-sm underline">
              {t("nav.signIn")}
            </Link>
            <Link href="/sign-up" className="text-sm underline">
              {t("nav.signUp")}
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
