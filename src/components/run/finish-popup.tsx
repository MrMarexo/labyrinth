"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";

import type { Finish } from "~/components/run/run-view";
import { Link } from "~/components/link";
import { formatElapsed } from "~/lib/format-elapsed";
import { api } from "~/trpc/react";

/**
 * Shown once, on the move that reached the treasure (spec §10.3). A native
 * modal `<dialog>`: it moves focus inside, keeps it there, and closes on
 * Escape. `ready` means the match is over and the result is on screen
 * behind it.
 */
export function FinishPopup({
  matchId,
  finish,
  ready,
  onClose,
}: {
  matchId: string;
  finish: Finish;
  ready: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("run");
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const { data } = api.run.get.useQuery({ matchId });
  const elapsed = data?.elapsedMs ?? null;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      data-finish-popup
      aria-modal="true"
      aria-labelledby={titleId}
      onClose={onClose}
      className="bg-bg text-fg border-border-strong backdrop:bg-fg/40 m-auto w-[min(24rem,calc(100vw-2rem))] space-y-4 rounded border p-6"
    >
      <h2 id={titleId} className="text-2xl">
        {t("finishTitle")}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">{t("penaltiesLabel")}</dt>
        <dd data-finish-penalties={finish.penalties} className="text-xl">
          {finish.penalties}
        </dd>
        <dt className="text-muted">{t("movesLabel")}</dt>
        <dd>{finish.moves}</dd>
        <dt className="text-muted">{t("timeLabel")}</dt>
        <dd data-finish-time>
          {elapsed === null ? "…" : formatElapsed(elapsed)}
        </dd>
      </dl>
      <p>{ready ? t("finishReady") : t("finishPending")}</p>
      <div className="flex flex-wrap items-center gap-3">
        {ready ? (
          <button
            type="button"
            autoFocus
            onClick={() => ref.current?.close()}
            className="bg-accent text-on-accent min-h-11 rounded px-3 py-2 text-sm"
          >
            {t("finishSeeResult")}
          </button>
        ) : (
          <Link
            href={`/matches/${matchId}/watch?run=opponent`}
            data-finish-watch-live
            className="text-sm"
          >
            {t("watchLive")}
          </Link>
        )}
        <button
          type="button"
          autoFocus={!ready}
          onClick={() => ref.current?.close()}
          className="border-border-strong min-h-11 rounded border px-3 py-2 text-sm"
        >
          {t("finishClose")}
        </button>
      </div>
    </dialog>
  );
}
