import { useTranslations } from "next-intl";

import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { Link } from "~/i18n/navigation";

export function SiteHeader() {
  const t = useTranslations("app");

  return (
    <header className="border-border flex items-center justify-between border-b px-4 py-3">
      <Link href="/" className="font-semibold">
        {t("name")}
      </Link>
      <div className="flex items-center gap-3">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
