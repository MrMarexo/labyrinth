"use client";

import { useTranslations } from "next-intl";
import { useRef, type KeyboardEvent } from "react";

import type { Tool } from "~/maze";

export type ShapeToolsProps = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  used: number;
  budget: number;
};

/** The two tools this palette offers, in display and arrow-key order. */
const SHAPE_TOOLS: readonly Tool[] = ["paint", "erase-cell"];

export function ShapeTools({ tool, onTool, used, budget }: ShapeToolsProps) {
  const t = useTranslations("editor");
  const buttonRefs = useRef(new Map<Tool, HTMLButtonElement>());

  function labelFor(option: Tool): string {
    return option === "paint" ? t("paint") : t("eraseCell");
  }

  // `tool` is shared with Task 6's detail palette, so it can hold a value
  // neither of these two buttons represents (e.g. "wall"). The group still
  // needs exactly one tab stop — the same rule a native radio group follows
  // when none of its inputs is checked — so the first option is the fallback
  // stop rather than leaving the group untabbable.
  const activeIndex = SHAPE_TOOLS.indexOf(tool);
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
        nextIndex = (tabStopIndex + 1) % SHAPE_TOOLS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex =
          (tabStopIndex - 1 + SHAPE_TOOLS.length) % SHAPE_TOOLS.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = SHAPE_TOOLS[nextIndex]!;
    onTool(next);
    buttonRefs.current.get(next)?.focus();
  }

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label={t("shapeToolsLabel")}
        className="flex gap-2"
      >
        {SHAPE_TOOLS.map((option, index) => {
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

      <p data-budget className="text-sm">
        {t("budget", { used, budget })}
      </p>
    </div>
  );
}

function buttonClass(active: boolean): string {
  return active
    ? "bg-accent text-on-accent rounded px-3 py-2 text-sm"
    : "border-border-strong rounded border px-3 py-2 text-sm";
}
