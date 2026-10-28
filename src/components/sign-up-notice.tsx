"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import { Link } from "~/components/link";
import { usePathname } from "~/i18n/navigation";

/**
 * Stands in for what only a member can do — the new-match form, the
 * labyrinth library — for a visitor or a guest. Both links come back here.
 */
export function SignUpNotice({ kind }: { kind: "matches" | "labyrinths" }) {
  const t = useTranslations("guest");
  const tn = useTranslations("nav");
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const next = search ? `${pathname}?${search}` : pathname;

  return (
    <section
      data-sign-up-notice={kind}
      className="border-border pixel space-y-3 border p-4"
    >
      <p>{t("notice")}</p>
      <div className="flex flex-wrap gap-3">
        <Link href={{ pathname: "/sign-up", query: { next } }}>
          {tn("signUp")}
        </Link>
        <Link href={{ pathname: "/sign-in", query: { next } }}>
          {tn("signIn")}
        </Link>
      </div>
    </section>
  );
}
