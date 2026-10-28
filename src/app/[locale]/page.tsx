import { useTranslations } from "next-intl";

import { HomeSummary } from "~/components/home-summary";

export default function HomePage() {
  const t = useTranslations("app");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-3xl">{t("name")}</h1>
        <p className="mt-2">{t("tagline")}</p>
      </div>
      <HomeSummary />
    </main>
  );
}
