"use client";

import { useId, type ReactNode } from "react";

import { RadioButtons } from "~/components/radio-buttons";

/**
 * A labelled row of text buttons acting as one radio group — the maze size
 * and gate count pickers on the New labyrinth and New match forms.
 */
export function OptionPicker<T extends number | string>({
  label,
  options,
  value,
  onChange,
  renderOption = String,
}: {
  label: ReactNode;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  renderOption?: (option: T) => ReactNode;
}) {
  const labelId = useId();

  return (
    <div className="space-y-1">
      <span id={labelId} className="text-sm">
        {label}
      </span>
      <RadioButtons
        aria-labelledby={labelId}
        options={options}
        value={value}
        onChange={onChange}
        renderOption={renderOption}
        className="flex flex-wrap gap-2"
        buttonClass={(active) =>
          active
            ? "bg-accent text-on-accent border-accent min-w-10 rounded border px-3 py-2 text-sm"
            : "border-border-strong min-w-10 rounded border px-3 py-2 text-sm"
        }
      />
    </div>
  );
}
