"use client";

import { useTranslations } from "next-intl";
import { useRef, type KeyboardEvent } from "react";

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
        className="flex flex-col gap-2"
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
              {preview(m.data)}
              <span>{m.name}</span>
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
 * Starts a labyrinth at exactly this match's settings and opens it in the
 * editor, which offers to use it here once it is drawn.
 */
function DrawNew({ match }: { match: MazePickerProps["match"] }) {
  const t = useTranslations("lobby");
  const te = useTranslations();
  const router = useRouter();
  const create = api.maze.createDraft.useMutation({
    onSuccess: ({ id }) => {
      router.push({
        pathname: `/labyrinths/${id}`,
        query: { match: match.id },
      });
    },
  });
  const error = create.isError
    ? resolveErrorKey(te, create.error, "errors.unknown")
    : null;

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-draw-new
        // Still pending while the editor loads, so it cannot fire twice.
        disabled={create.isPending || create.isSuccess}
        onClick={() =>
          create.mutate({
            name: t("newMazeName", { code: match.code }),
            cellCount: match.cellCount,
            gateCount: match.gateCount,
          })
        }
        className="border-border-strong rounded border px-3 py-2 text-sm disabled:opacity-50"
      >
        {create.isPending || create.isSuccess ? t("creatingNew") : t("drawNew")}
      </button>
      {error && (
        <p role="alert" data-draw-new-error className="text-danger text-sm">
          {te(error.key as never, error.params as never)}
        </p>
      )}
    </div>
  );
}

function optionClass(active: boolean): string {
  const base = "flex items-center gap-3 rounded px-3 py-2 text-left text-sm";
  return active
    ? `${base} bg-accent text-on-accent`
    : `${base} border-border-strong border`;
}
