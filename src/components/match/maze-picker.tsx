"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent } from "react";

import { discardsSettled } from "~/components/editor/pending-discards";

import { MazePreview } from "~/components/maze-drawing";
import { useRouter } from "~/i18n/navigation";
import { resolveErrorKey } from "~/lib/resolve-error-key";
import { draftToMaze } from "~/maze";
import { api } from "~/trpc/react";

export type MazePickerProps = {
  match: { id: string; code: string; cellCount: number; gateCount: number };
  selected: string | null;
  onSelect: (id: string) => void;
};

export function MazePicker({ match, selected, onSelect }: MazePickerProps) {
  const t = useTranslations("lobby");
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const { data, isPending } = api.match.eligibleMazes.useQuery({
    matchId: match.id,
  });

  // Branch on pending before treating an empty list as "none eligible", so
  // an author with eligible mazes does not see the empty state flash before
  // their library arrives.
  if (isPending) return null;

  const drawNew = <DrawNew match={match} />;
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
      <h2 id="maze-picker-heading" className="text-sm font-medium">
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
              onClick={() => onSelect(m.id)}
              onKeyDown={handleKeyDown}
              className={optionClass(active)}
            >
              <span data-maze-name className="w-full truncate">
                {m.name}
              </span>
              {preview(m.data)}
            </button>
          );
        })}
      </div>
      {drawNew}
    </div>
  );
}

/** The maze's thumbnail; nothing for a draft that is somehow incomplete. */
function preview(data: Parameters<typeof draftToMaze>[0]) {
  const maze = draftToMaze(data);
  return maze ? <MazePreview maze={maze} /> : null;
}

/**
 * Opens an empty labyrinth at exactly this match's settings in the editor,
 * which offers to use it here once it is drawn. The server reuses one of the
 * player's own empty drafts at these settings rather than making another.
 */
function DrawNew({ match }: { match: MazePickerProps["match"] }) {
  const t = useTranslations("lobby");
  const te = useTranslations();
  const router = useRouter();
  const utils = api.useUtils();
  // True while an editor that just closed may still be discarding the very
  // draft the server would hand back.
  const [waiting, setWaiting] = useState(false);
  const create = api.maze.draftForMatch.useMutation({
    onSuccess: ({ id }) => {
      void utils.maze.list.invalidate();
      router.push({
        pathname: `/labyrinths/${id}`,
        query: { match: match.id },
      });
    },
  });
  const error = create.isError
    ? resolveErrorKey(te, create.error, "errors.unknown")
    : null;
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
    </div>
  );
}

/**
 * A square tile the width of its preview, name on top. Selection is the
 * border alone — an accent outline, never a fill — so the preview stays
 * readable either way.
 */
function optionClass(active: boolean): string {
  const base =
    "flex w-32 flex-col gap-2 rounded-lg border-2 p-2 text-left text-sm sm:w-36";
  return active
    ? `${base} border-accent`
    : `${base} border-border hover:border-border-strong`;
}
