"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent } from "react";

import { discardsSettled } from "~/components/editor/pending-discards";
import { useReplaceConcept } from "~/components/editor/replace-concept";
import { Link } from "~/components/link";

import { MazeTile, mazeTileClass } from "~/components/maze-tile";
import { useRouter } from "~/i18n/navigation";
import { draftToMaze } from "~/maze";
import { api } from "~/trpc/react";

export type MazePickerProps = {
  match: { id: string; code: string; cellCount: number; gateCount: number };
  selected: string | null;
  /** `null` when the player clicks the selected one again to clear it. */
  onSelect: (id: string | null) => void;
};

export function MazePicker({ match, selected, onSelect }: MazePickerProps) {
  const t = useTranslations("lobby");
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const tl = useTranslations("labyrinths");
  const { data: eligible, isPending } = api.match.eligibleMazes.useQuery({
    matchId: match.id,
  });

  // Branch on pending before treating an empty list as "none eligible", so
  // an author with eligible mazes does not see the empty state flash before
  // their library arrives.
  if (isPending) return null;

  // A half-drawn concept is offered to finish in the editor, never to use.
  const unfinished = eligible?.find((m) => m.concept && !m.valid) ?? null;
  const data = eligible?.filter((m) => m.valid);
  const drawNew = (
    <div className="flex flex-wrap items-start gap-3">
      {unfinished && (
        <Link
          href={{
            pathname: `/labyrinths/${unfinished.id}`,
            query: { match: match.id },
          }}
          prefetch={false}
          data-continue-concept
          className="border-border-strong rounded border px-3 py-2 text-sm"
        >
          {t("continueConcept", { name: unfinished.name })}
        </Link>
      )}
      <DrawNew match={match} />
    </div>
  );
  if (!data || data.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-muted text-sm">{t("noneEligible")}</p>
        {drawNew}
      </div>
    );
  }

  // This picker genuinely starts with nothing selected — unlike a group
  // that defaults to its first option, `selected` is `null` until the
  // player makes a choice. A native radio group with no input checked still
  // has exactly one tab stop, so the roving stop below falls back to index 0
  // rather than leaving the whole group unreachable by keyboard.
  const activeIndex = data.findIndex((m) => m.id === selected);
  const tabStopIndex = activeIndex === -1 ? 0 : activeIndex;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!data || data.length === 0) return;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (tabStopIndex + 1) % data.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (tabStopIndex - 1 + data.length) % data.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = data[nextIndex]!;
    onSelect(next.id);
    buttonRefs.current.get(next.id)?.focus();
  }

  return (
    <div className="space-y-2">
      <h2 id="maze-picker-heading" className="text-sm">
        {t("pickHeading")}
      </h2>
      <div
        role="radiogroup"
        aria-labelledby="maze-picker-heading"
        className="flex flex-wrap gap-3"
      >
        {data.map((m, index) => {
          const active = m.id === selected;
          return (
            <button
              key={m.id}
              ref={(el) => {
                if (el) buttonRefs.current.set(m.id, el);
                else buttonRefs.current.delete(m.id);
              }}
              type="button"
              role="radio"
              aria-checked={active}
              data-maze-option={m.id}
              tabIndex={index === tabStopIndex ? 0 : -1}
              onClick={() => onSelect(active ? null : m.id)}
              onKeyDown={handleKeyDown}
              className={mazeTileClass({ selected: active, hoverable: true })}
            >
              <MazeTile
                name={
                  <span data-maze-name className="w-full truncate">
                    {m.name}
                  </span>
                }
                maze={draftToMaze(m.data)}
              >
                {m.concept && (
                  <span data-concept-badge className="text-muted text-xs">
                    {tl("conceptBadge")}
                  </span>
                )}
              </MazeTile>
            </button>
          );
        })}
      </div>
      {drawNew}
    </div>
  );
}

/**
 * Opens an empty concept at exactly this match's settings in the editor,
 * which offers to use it here once it is drawn. The server hands back the
 * player's concept if it is empty and at these settings; any other concept
 * is replaced only once the player agrees in a popup.
 */
function DrawNew({ match }: { match: MazePickerProps["match"] }) {
  const t = useTranslations("lobby");
  const te = useTranslations();
  const router = useRouter();
  const utils = api.useUtils();
  // True while an editor that just closed may still be discarding the very
  // concept the server would hand back.
  const [waiting, setWaiting] = useState(false);
  const create = api.maze.conceptForMatch.useMutation({
    onSuccess: ({ id }) => {
      void utils.maze.list.invalidate();
      router.push({
        pathname: `/labyrinths/${id}`,
        query: { match: match.id },
      });
    },
  });
  const { error, dialog } = useReplaceConcept(create);
  const busy = waiting || create.isPending || create.isSuccess;

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-draw-new
        // Still pending while the editor loads, so it cannot fire twice.
        disabled={busy}
        onClick={async () => {
          setWaiting(true);
          await discardsSettled();
          setWaiting(false);
          create.mutate({
            matchId: match.id,
            name: t("newMazeName", { code: match.code }),
          });
        }}
        className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
      >
        {busy ? t("creatingNew") : t("drawNew")}
      </button>
      {error && (
        <p role="alert" data-draw-new-error className="text-danger text-sm">
          {te(error.key as never, error.params as never)}
        </p>
      )}
      {dialog}
    </div>
  );
}
