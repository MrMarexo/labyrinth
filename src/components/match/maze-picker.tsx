"use client";

import { useTranslations } from "next-intl";
import { useRef, type KeyboardEvent } from "react";

import { Link } from "~/i18n/navigation";
import { api } from "~/trpc/react";

export type MazePickerProps = {
  matchId: string;
  selected: string | null;
  onSelect: (id: string) => void;
};

export function MazePicker({ matchId, selected, onSelect }: MazePickerProps) {
  const t = useTranslations("lobby");
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const { data, isPending } = api.match.eligibleMazes.useQuery({ matchId });

  // Branch on pending before treating an empty list as "none eligible", so
  // an author with eligible mazes does not see the empty state flash before
  // their library arrives.
  if (isPending) return null;
  if (!data || data.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-muted text-sm">{t("noneEligible")}</p>
        <Link href="/labyrinths" className="underline">
          {t("drawNew")}
        </Link>
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
              <span>{m.name}</span>
              <span className="text-muted text-xs">
                {m.status === "submitted" ? t("mazeSubmitted") : t("mazeDraft")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function optionClass(active: boolean): string {
  const base = "flex flex-col items-start gap-0.5 rounded px-3 py-2 text-sm";
  return active
    ? `${base} bg-accent text-on-accent`
    : `${base} border-border-strong border`;
}
