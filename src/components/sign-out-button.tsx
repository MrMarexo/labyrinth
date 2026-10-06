"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { useRouter } from "~/i18n/navigation";
import { signOut } from "~/lib/auth-client";

export function SignOutButton() {
  const t = useTranslations("nav");
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <button
      type="button"
      className="text-sm underline"
      onClick={async () => {
        await signOut();
        // The browser's QueryClient is a module-level singleton (see
        // `~/trpc/react`) that outlives this navigation. Its keys carry a
        // procedure path and input, never a user id, so without this the
        // next person to use this tab can land on a still-fresh
        // `match.list` or `match.get` cached under the account that just
        // signed out — join codes and an opponent's name included.
        queryClient.clear();
        router.replace("/");
        router.refresh();
      }}
    >
      {t("signOut")}
    </button>
  );
}
