"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Link } from "~/components/link";
import { usePathname } from "~/i18n/navigation";
import { safeNext } from "~/lib/safe-next";

const AUTH_PAGES = ["/sign-in", "/sign-up"];

/**
 * The header's sign-in and sign-up links. Both come back to the page they
 * were followed from, as `SignUpNotice` and `LobbyAction` do; on the auth
 * pages themselves they pass the existing `next` along instead.
 */
export function AuthLinks() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const next = AUTH_PAGES.includes(pathname)
    ? safeNext(params.get("next"))
    : search
      ? `${pathname}?${search}`
      : pathname;
  const query = next ? { next } : undefined;

  return (
    <>
      <Link href={{ pathname: "/sign-in", query }} className="text-sm">
        {t("signIn")}
      </Link>
      <Link href={{ pathname: "/sign-up", query }} className="text-sm">
        {t("signUp")}
      </Link>
    </>
  );
}
