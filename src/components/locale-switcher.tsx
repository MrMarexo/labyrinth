"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { usePathname, useRouter } from "~/i18n/navigation";
import { locales, type Locale } from "~/i18n/routing";
import { api } from "~/trpc/react";

export function LocaleSwitcher() {
  const t = useTranslations("locale");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const setLocale = api.profile.setLocale.useMutation();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t("label")}</span>
      <select
        aria-label={t("label")}
        className="border-border-strong bg-bg rounded border px-2 py-1"
        disabled={pending}
        value={locale}
        onChange={(event) => {
          const next = event.target.value as Locale;
          // Fired unconditionally. Gating on a client useSession() would cost
          // a session request on every page and silently drop the preference
          // when the language is switched before that fetch resolves; a
          // signed-out visitor just gets UNAUTHORIZED, which is not an error
          // worth showing.
          void setLocale.mutateAsync({ locale: next }).catch(() => {
            // A failed preference save must not block the language change.
          });
          startTransition(() => {
            router.replace(pathname, { locale: next });
          });
        }}
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {t(code)}
          </option>
        ))}
      </select>
    </label>
  );
}
