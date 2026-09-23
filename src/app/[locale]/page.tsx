import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("app");

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">{t("name")}</h1>
      <p className="mt-2">{t("tagline")}</p>
    </main>
  );
}
