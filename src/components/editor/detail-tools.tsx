"use client";

import { useTranslations } from "next-intl";
import { useRef, type KeyboardEvent } from "react";

import type { Tool } from "~/maze";

export type DetailToolsProps = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  gates: number;
  gateBudget: number;
  keys: number;
};

/** The six tools this palette offers, in display and arrow-key order. */
const DETAIL_TOOLS: readonly Tool[] = [
  "wall",
  "gate",
  "key",
  "start",
  "treasure",
  "erase",
];

export function DetailTools({
  tool,
  onTool,
  gates,
  gateBudget,
  keys,
}: DetailToolsProps) {
  const t = useTranslations("editor");
  const buttonRefs = useRef(new Map<Tool, HTMLButtonElement>());

  function labelFor(option: Tool): string {
    switch (option) {
      case "wall":
        return t("wall");
      case "gate":
        return t("gate");
      case "key":
        return t("key");
      case "start":
        return t("start");
      case "treasure":
        return t("treasure");
      default:
        return t("erase");
    }
  }

  // `tool` is shared with Task 5's shape palette, so it can hold a value none
  // of these six buttons represents (e.g. "paint"). The group still needs
  // exactly one tab stop — the same rule a native radio group follows when
  // none of its inputs is checked — so the first option is the fallback stop
  // rather than leaving the group untabbable, and no button claims to be
  // checked.
  const activeIndex = DETAIL_TOOLS.indexOf(tool);
  const tabStopIndex = activeIndex === -1 ? 0 : activeIndex;

  // A native radio group moves both focus and the checked state together on
  // an arrow key, regardless of the group's visual orientation — all four
  // arrow keys cycle, not just the two matching this row's layout. Selecting
  // also moves DOM focus to the newly active button, so the roving tabIndex
  // below and the actual focus target never disagree.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (tabStopIndex + 1) % DETAIL_TOOLS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex =
          (tabStopIndex - 1 + DETAIL_TOOLS.length) % DETAIL_TOOLS.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = DETAIL_TOOLS[nextIndex]!;
    onTool(next);
    buttonRefs.current.get(next)?.focus();
  }

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label={t("detailToolsLabel")}
        className="flex flex-wrap gap-2"
      >
        {DETAIL_TOOLS.map((option, index) => {
          const active = tool === option;
          return (
            <button
              key={option}
              ref={(el) => {
                if (el) buttonRefs.current.set(option, el);
                else buttonRefs.current.delete(option);
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={index === tabStopIndex ? 0 : -1}
              onClick={() => onTool(option)}
              onKeyDown={handleKeyDown}
              className={buttonClass(active)}
            >
              {labelFor(option)}
            </button>
          );
        })}
      </div>

      <p data-gates className="text-sm">
        {t("gates", { gates, gateBudget })}
      </p>
      <p data-keys className="text-sm">
        {t("keys", { keys })}
      </p>
    </div>
  );
}

function buttonClass(active: boolean): string {
  return active
    ? "bg-accent text-on-accent rounded px-3 py-2 text-sm"
    : "border-border-strong rounded border px-3 py-2 text-sm";
}
