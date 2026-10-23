"use client";

import { useTranslations } from "next-intl";

import { useRouter } from "~/i18n/navigation";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { CODE_LENGTH } from "~/match";
import { api } from "~/trpc/react";

export function JoinMatchForm() {
  const t = useTranslations("matches");
  const te = useTranslations();
  const router = useRouter();

  const utils = api.useUtils();
  const join = api.match.join.useMutation({
    onSuccess: ({ id }) => {
      void utils.match.list.invalidate();
      router.push(`/matches/${id}`);
    },
  });
  const joinError = join.isError
    ? resolveErrorKey(te, join.error, "errors.unknown")
    : null;

  return (
    <form
      className="border-border-strong space-y-3 rounded border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const code = data.get("code");
        // Joining is by match id now; Task 8 replaces this form.
        join.mutate({ matchId: typeof code === "string" ? code : "" });
      }}
    >
      <h2 className="text-xl font-semibold">{t("joinHeading")}</h2>

      <label className="block space-y-1">
        <span className="text-sm">{t("code")}</span>
        <input
          name="code"
          required
          maxLength={CODE_LENGTH}
          autoCapitalize="characters"
          autoComplete="off"
          inputMode="text"
          className="border-border-strong bg-bg w-full rounded border px-3 py-2 uppercase"
        />
      </label>
      <p className="text-muted text-sm">{t("codeHint")}</p>

      {joinError && (
        <p role="alert" data-join-error className="text-danger text-sm">
          {te(joinError.key as never, joinError.params as never)}
        </p>
      )}

      <button
        type="submit"
        disabled={join.isPending}
        className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
      >
        {join.isPending ? t("joining") : t("join")}
      </button>
    </form>
  );
}
