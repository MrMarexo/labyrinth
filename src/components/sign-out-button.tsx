"use client";

import { useTranslations } from "next-intl";

import { useRouter } from "~/i18n/navigation";
import { signOut } from "~/lib/auth-client";

export function SignOutButton() {
  const t = useTranslations("nav");
  const router = useRouter();

  return (
    <button
      type="button"
      className="text-sm underline"
      onClick={async () => {
        await signOut();
        router.replace("/");
        router.refresh();
      }}
    >
      {t("signOut")}
    </button>
  );
}
