"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { OptionPicker } from "~/components/option-picker";
import { usePathname, useRouter } from "~/i18n/navigation";
import { locales } from "~/i18n/routing";
import { api } from "~/trpc/react";

export function LocaleSwitcher() {
  const t = useTranslations("locale");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const setLocale = api.profile.setLocale.useMutation();

  return (
    <OptionPicker
      label={t("label")}
      options={locales}
      value={locale}
      disabled={pending}
      onChange={(next) => {
        if (next === locale) return;
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
      renderOption={(code) => t(code)}
    />
  );
}
