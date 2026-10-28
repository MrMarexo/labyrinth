"use client";

import { useId, type ReactNode } from "react";

import { RadioButtons } from "~/components/radio-buttons";

/**
 * A labelled row of text buttons acting as one radio group. The app has no
 * native selects: every choice among a few options is one of these — maze
 * size and gates on the new forms, the labyrinth filters, theme and language.
 */
export function OptionPicker<T extends number | string>({
  label,
  options,
  value,
  onChange,
  renderOption = String,
  disabled = false,
  "aria-label": ariaLabel,
}: {
  label: ReactNode;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  renderOption?: (option: T) => ReactNode;
  disabled?: boolean;
  /** Overrides the visible label as the group's name, where two would clash. */
  "aria-label"?: string;
}) {
  const labelId = useId();

  return (
    <div className="space-y-1">
      <span id={labelId} className="text-sm">
        {label}
      </span>
      <RadioButtons
        {...(ariaLabel
          ? { "aria-label": ariaLabel }
          : { "aria-labelledby": labelId })}
        disabled={disabled}
        options={options}
        value={value}
        onChange={onChange}
        renderOption={renderOption}
        className="flex flex-wrap gap-2"
        buttonClass={(active) =>
          active
            ? "bg-accent text-on-accent border-accent min-w-10 pixel border px-3 py-2 text-sm"
            : "border-border-strong min-w-10 pixel border px-3 py-2 text-sm disabled:opacity-50"
        }
      />
    </div>
  );
}
