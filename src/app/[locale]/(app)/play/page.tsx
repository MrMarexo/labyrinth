import { useTranslations } from "next-intl";

export default function PlayPage() {
  const t = useTranslations("play");

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">{t("title")}</h1>
      <p className="text-muted mt-2">{t("empty")}</p>
    </main>
  );
}
