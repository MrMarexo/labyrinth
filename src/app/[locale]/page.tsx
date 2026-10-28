import { getTranslations } from "next-intl/server";

import { HomeSummary } from "~/components/home-summary";
import { CurrentMatch } from "~/components/match/match-list";
import { Link as LocaleLink } from "~/i18n/navigation";
import { api } from "~/trpc/server";

// The plain locale link: the shared `Link` fades its text colour on hover,
// which would fight the border style.
const buttonLink =
  "border-border-strong hover:border-fg rounded border px-3 py-2 text-sm";

export default async function HomePage() {
  const t = await getTranslations();
  const viewer = await api.viewer.get();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold">{t("app.name")}</h1>
        <p className="mt-2">{t("app.tagline")}</p>
      </div>
      {viewer.kind === "member" ? (
        <HomeSummary />
      ) : (
        <div data-home-welcome className="space-y-6">
          {viewer.kind === "guest" && <CurrentMatch />}
          <nav className="flex flex-wrap gap-3">
            <LocaleLink href="/sign-up" className={buttonLink}>
              {t("nav.signUp")}
            </LocaleLink>
            <LocaleLink href="/sign-in" className={buttonLink}>
              {t("nav.signIn")}
            </LocaleLink>
            <LocaleLink href="/matches" className={buttonLink}>
              {t("home.findMatch")}
            </LocaleLink>
          </nav>
        </div>
      )}
    </main>
  );
}
