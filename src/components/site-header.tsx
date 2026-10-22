import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { SettingsMenu } from "~/components/settings-menu";
import { SignOutButton } from "~/components/sign-out-button";
import { Link } from "~/i18n/navigation";
import { getSession } from "~/server/auth";

export async function SiteHeader() {
  const t = await getTranslations();
  const session = await getSession(await headers());

  return (
    <header className="border-border flex items-center justify-between border-b px-4 py-3">
      <Link href="/" className="font-semibold">
        {t("app.name")}
      </Link>
      <div className="flex items-center gap-3">
        {session && (
          <nav className="flex items-center gap-3">
            <Link href="/matches" className="text-sm underline">
              {t("nav.matches")}
            </Link>
            <Link href="/labyrinths" className="text-sm underline">
              {t("nav.labyrinths")}
            </Link>
          </nav>
        )}
        <SettingsMenu />
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
