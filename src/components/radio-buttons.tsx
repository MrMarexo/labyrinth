"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * A row of buttons acting as one radio group. A native radio group moves
 * both focus and the checked state together on an arrow key, regardless of
 * the group's visual orientation — all four arrow keys cycle, not just the
 * two matching the row's layout. Selecting also moves DOM focus to the newly
 * active button, so the roving tabIndex and the actual focus target never
 * disagree.
 *
 * `value` may match none of `options` (a tool from another palette); the
 * group still needs exactly one tab stop — the same rule a native radio
 * group follows when none of its inputs is checked — so the first option is
 * the fallback stop.
 */
export function RadioButtons<T extends number | string>({
  options,
  value,
  onChange,
  renderOption,
  optionLabel,
  buttonClass,
  className,
  disabled = false,
  ...group
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  renderOption: (option: T) => ReactNode;
  /** An accessible name, for options whose content is only an icon. */
  optionLabel?: (option: T) => string;
  buttonClass: (active: boolean) => string;
  className?: string;
  disabled?: boolean;
} & ({ "aria-label": string } | { "aria-labelledby": string })) {
  const buttonRefs = useRef(new Map<T, HTMLButtonElement>());

  const activeIndex = options.indexOf(value);
  const tabStopIndex = activeIndex === -1 ? 0 : activeIndex;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (tabStopIndex + 1) % options.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (tabStopIndex - 1 + options.length) % options.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = options[nextIndex]!;
    onChange(next);
    buttonRefs.current.get(next)?.focus();
  }

  return (
    <div role="radiogroup" {...group} className={className}>
      {options.map((option, index) => {
        const active = value === option;
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
            aria-label={optionLabel?.(option)}
            tabIndex={index === tabStopIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option)}
            onKeyDown={handleKeyDown}
            className={buttonClass(active)}
          >
            {renderOption(option)}
          </button>
        );
      })}
    </div>
  );
}
