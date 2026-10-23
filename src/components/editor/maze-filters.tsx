"use client";

import { useTranslations } from "next-intl";

import type { LibrarySort, LibraryView } from "./maze-library";

const STATES = [
  ["all", "filterAll"],
  ["draft", "filterDrafts"],
  ["ready", "filterReady"],
  ["used", "filterUsed"],
] as const;

const SORTS = [
  ["edited", "sortEdited"],
  ["name", "sortName"],
  ["size", "sortSize"],
] as const;

const selectClass = "border-border-strong bg-bg rounded border px-2 py-1";

/** The state, size and sort controls above the /labyrinths tiles. */
export function MazeFilters({
  view,
  sizes,
  onChange,
}: {
  view: LibraryView;
  /** Only the sizes the player has, so no choice can name one they don't. */
  sizes: { squares: number[]; gates: number[] };
  onChange: (view: LibraryView) => void;
}) {
  const t = useTranslations("labyrinths");
  const size = (value: string) => (value === "any" ? "any" : Number(value));

  return (
    <div className="flex flex-wrap items-end gap-4 text-sm">
      <fieldset className="space-y-1">
        <legend className="mb-1">{t("filterState")}</legend>
        <div className="border-border-strong flex overflow-hidden rounded border">
          {STATES.map(([value, label]) => (
            <label key={value} className="relative">
              <input
                type="radio"
                name="maze-state"
                value={value}
                checked={view.state === value}
                onChange={() => onChange({ ...view, state: value })}
                // Invisible but covering its label, so the native radio is
                // what gets clicked and arrow keys move between them.
                className="peer absolute inset-0 cursor-pointer appearance-none opacity-0"
              />
              <span className="peer-checked:bg-accent peer-checked:text-on-accent peer-focus-visible:outline-accent block px-3 py-1 transition-colors peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2">
                {t(label)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="space-y-1">
        <span className="block">{t("squares")}</span>
        <select
          value={String(view.squares)}
          onChange={(e) => onChange({ ...view, squares: size(e.target.value) })}
          className={selectClass}
        >
          <option value="any">{t("filterAny")}</option>
          {sizes.squares.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="block">{t("gates")}</span>
        <select
          value={String(view.gates)}
          onChange={(e) => onChange({ ...view, gates: size(e.target.value) })}
          className={selectClass}
        >
          <option value="any">{t("filterAny")}</option>
          {sizes.gates.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="block">{t("sortLabel")}</span>
        <select
          value={view.sort}
          onChange={(e) =>
            onChange({ ...view, sort: e.target.value as LibrarySort })
          }
          className={selectClass}
        >
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
