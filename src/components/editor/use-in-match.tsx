"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmUse } from "~/components/match/confirm-use";
import { useRouter } from "~/i18n/navigation";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { api } from "~/trpc/react";

/**
 * The editor's way back to the match it was opened from (spec §10.2):
 * once the maze is valid and saved, submit it there and return to the
 * match, which shows the lobby or the run.
 */
export function UseInMatch({
  mazeId,
  name,
  match,
  ready,
}: {
  mazeId: string;
  name: string;
  match: { id: string; code: string };
  ready: boolean;
}) {
  const t = useTranslations("editor");
  const te = useTranslations();
  const router = useRouter();
  const utils = api.useUtils();
  const [confirming, setConfirming] = useState(false);
  const submit = api.match.submitMaze.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.match.get.invalidate({ id: match.id }),
        utils.match.list.invalidate(),
      ]);
      router.push(`/matches/${match.id}`);
    },
  });
  const error = submit.isError
    ? resolveErrorKey(te, submit.error, "errors.unknown")
    : null;
  // Pending until the match page has replaced this one.
  const pending = submit.isPending || submit.isSuccess;

  return (
    <div className="space-y-2">
      {confirming ? (
        <ConfirmUse
          name={name}
          pending={pending}
          ready={ready}
          onConfirm={() => submit.mutate({ matchId: match.id, mazeId })}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button
          type="button"
          data-use-in-match
          disabled={!ready}
          onClick={() => setConfirming(true)}
          className="bg-accent text-on-accent rounded px-3 py-2 text-sm disabled:opacity-50"
        >
          {t("useInMatch")}
        </button>
      )}
      {error && (
        <p role="alert" data-submit-error className="text-danger text-sm">
          {te(error.key as never, error.params as never)}
        </p>
      )}
    </div>
  );
}
