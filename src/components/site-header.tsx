import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { Link } from "~/components/link";
import { SiteMenu } from "~/components/site-menu";
import { getSession } from "~/server/auth";

export async function SiteHeader() {
  const t = await getTranslations();
  const session = await getSession(await headers());
  const guest = session?.user.isAnonymous ? session.user : null;
  const member = session && !guest ? session.user : null;

  return (
    <header className="border-border flex items-center justify-between border-b px-4 py-3">
      <Link href="/" className="font-semibold">
        {t("app.name")}
      </Link>
      <div className="flex items-center gap-3">
        {/* On a phone these move into the menu. A guest has no library. */}
        {session && (
          <nav data-header-nav className="hidden items-center gap-3 sm:flex">
            <Link href="/matches" className="text-sm">
              {t("nav.matches")}
            </Link>
            {member && (
              <Link href="/labyrinths" className="text-sm">
                {t("nav.labyrinths")}
              </Link>
            )}
          </nav>
        )}
        {guest && (
          <span data-guest-name className="text-muted text-sm">
            {t("players.guestName", { number: guest.name })}
          </span>
        )}
        {!member && (
          <>
            <Link href="/sign-in" className="text-sm">
              {t("nav.signIn")}
            </Link>
            <Link href="/sign-up" className="text-sm">
              {t("nav.signUp")}
            </Link>
          </>
        )}
        <SiteMenu viewer={member ? "member" : guest ? "guest" : "visitor"} />
      </div>
    </header>
  );
}
