"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, type KeyboardEvent } from "react";

import { iconButtonClass, Tooltip } from "~/components/tooltip";
import type { Tool } from "~/maze";
import { gateColour } from "./gate-colours";
import { PALETTE_GROUP, PALETTE_ROWS, ToolIcon } from "./tool-icons";

export type DetailToolsProps = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  gates: number;
  gateBudget: number;
  keys: number;
  /** The gate or key number the gate and key tools place. */
  chosen: number | null;
  onChoose: (gate: number) => void;
  /** Numbers the active tool has already placed. */
  placed: ReadonlySet<number>;
};

/**
 * The six tools in display groups, one row each on a desktop and side by
 * side on a phone: the wall and its eraser,
 * the two ends of the run, then the gate and its key, right above the colour
 * picker they open. Arrow keys walk them in this order.
 */
const DETAIL_GROUPS: readonly (readonly Tool[])[] = [
  ["wall", "erase"],
  ["start", "treasure"],
  ["gate", "key"],
];
const DETAIL_TOOLS: readonly Tool[] = DETAIL_GROUPS.flat();

export function DetailTools({
  tool,
  onTool,
  gates,
  gateBudget,
  keys,
  chosen,
  onChoose,
  placed,
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
        className={PALETTE_ROWS}
      >
        {DETAIL_GROUPS.map((group, i) => (
          <div
            key={group[0]}
            className={i === 0 ? "flex gap-2" : PALETTE_GROUP}
          >
            {group.map((option) => {
              const index = DETAIL_TOOLS.indexOf(option);
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
                  aria-label={labelFor(option)}
                  tabIndex={index === tabStopIndex ? 0 : -1}
                  onClick={() => onTool(option)}
                  onKeyDown={handleKeyDown}
                  className={iconButtonClass(active)}
                >
                  <ToolIcon tool={option} />
                  <Tooltip label={labelFor(option)} />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {(tool === "gate" || tool === "key") && gateBudget > 0 && (
        <NumberPicker
          kind={tool}
          count={gateBudget}
          chosen={chosen}
          onChoose={onChoose}
          placed={placed}
        />
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:flex-col lg:gap-y-3">
        <p data-gates>{t("gates", { gates, gateBudget })}</p>
        <p data-keys>{t("keys", { keys })}</p>
      </div>
    </div>
  );
}

type NumberPickerProps = {
  kind: "gate" | "key";
  count: number;
  chosen: number | null;
  onChoose: (gate: number) => void;
  placed: ReadonlySet<number>;
};

/**
 * Which gate, or which gate's key, the active tool places: one radio per
 * gate the maze allows, 1 to `count`, shown as its colour alone — gates are
 * told apart by colour, never by number. The number stays in the accessible
 * name. The same radiogroup pattern as the palettes above.
 */
function NumberPicker({
  kind,
  count,
  chosen,
  onChoose,
  placed,
}: NumberPickerProps) {
  const t = useTranslations("editor");
  const buttonRefs = useRef(new Map<number, HTMLButtonElement>());
  const numbers = Array.from({ length: count }, (_, i) => i + 1);

  const activeIndex = chosen === null ? -1 : numbers.indexOf(chosen);
  const tabStopIndex = activeIndex === -1 ? 0 : activeIndex;

  function labelFor(n: number): string {
    if (kind === "gate") {
      return placed.has(n)
        ? t("gateOptionPlaced", { gate: n })
        : t("gateOption", { gate: n });
    }
    return placed.has(n)
      ? t("keyOptionPlaced", { gate: n })
      : t("keyOption", { gate: n });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (tabStopIndex + 1) % numbers.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (tabStopIndex - 1 + numbers.length) % numbers.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = numbers[nextIndex]!;
    onChoose(next);
    buttonRefs.current.get(next)?.focus();
  }

  const hook = kind === "gate" ? "data-gate-option" : "data-key-option";

  return (
    <div
      role="radiogroup"
      aria-label={kind === "gate" ? t("gatePickerLabel") : t("keyPickerLabel")}
      className="flex flex-wrap gap-2"
    >
      {numbers.map((n, index) => {
        const active = chosen === n;
        return (
          <button
            key={n}
            ref={(el) => {
              if (el) buttonRefs.current.set(n, el);
              else buttonRefs.current.delete(n);
            }}
            type="button"
            role="radio"
            {...{ [hook]: n }}
            aria-checked={active}
            aria-label={labelFor(n)}
            tabIndex={index === tabStopIndex ? 0 : -1}
            onClick={() => onChoose(n)}
            onKeyDown={handleKeyDown}
            className={iconButtonClass(active)}
          >
            <svg aria-hidden="true" viewBox="0 0 10 10" className="size-5">
              <circle
                data-swatch
                cx={5}
                cy={5}
                r={5}
                style={{ fill: gateColour(n) }}
              />
            </svg>
            {placed.has(n) && (
              <Check
                aria-hidden="true"
                strokeWidth={3}
                className="absolute top-0.5 right-0.5 size-3"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
