"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { resolveErrorKey } from "~/lib/resolve-error-key";
import { api } from "~/trpc/react";

/**
 * Cancels a match still waiting for an opponent, after a confirmation step:
 * the match is deleted, and its join code stops working.
 */
export function CancelMatch({
  matchId,
  onCancelled,
}: {
  matchId: string;
  onCancelled?: () => void;
}) {
  const t = useTranslations("matches");
  const te = useTranslations();
  const utils = api.useUtils();
  const [confirming, setConfirming] = useState(false);
  const cancel = api.match.cancel.useMutation({
    onSuccess: () => {
      setConfirming(false);
      void utils.match.list.invalidate();
      onCancelled?.();
    },
  });
  const error = cancel.isError
    ? resolveErrorKey(te, cancel.error, "errors.unknown")
    : null;

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="space-y-2">
          <p className="text-sm">{t("cancelConfirm")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ matchId })}
              className="border-danger text-danger rounded border px-3 py-2 text-sm disabled:opacity-50"
            >
              {cancel.isPending ? t("cancelling") : t("cancelYes")}
            </button>
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={() => setConfirming(false)}
              className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
            >
              {t("cancelNo")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-cancel-match
          onClick={() => setConfirming(true)}
          className="text-danger text-sm underline"
        >
          {t("cancel")}
        </button>
      )}
      {error && (
        <p role="alert" data-cancel-error className="text-danger text-sm">
          {te(error.key as never, error.params as never)}
        </p>
      )}
    </div>
  );
}
