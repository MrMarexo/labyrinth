"use client";

import { useTranslations } from "next-intl";

import { OptionPicker } from "~/components/option-picker";

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

const STATE_LABELS = Object.fromEntries(STATES) as Record<
  LibraryView["state"],
  (typeof STATES)[number][1]
>;
const SORT_LABELS = Object.fromEntries(SORTS) as Record<
  LibrarySort,
  (typeof SORTS)[number][1]
>;

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
  const any = (option: number | "any") =>
    option === "any" ? t("filterAny") : option;

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
      <OptionPicker
        label={t("filterState")}
        options={STATES.map(([value]) => value)}
        value={view.state}
        onChange={(state) => onChange({ ...view, state })}
        renderOption={(option) => t(STATE_LABELS[option])}
      />
      <OptionPicker<number | "any">
        label={t("squares")}
        options={["any", ...sizes.squares]}
        value={view.squares}
        onChange={(squares) => onChange({ ...view, squares })}
        renderOption={any}
      />
      <OptionPicker<number | "any">
        label={t("gates")}
        options={["any", ...sizes.gates]}
        value={view.gates}
        onChange={(gates) => onChange({ ...view, gates })}
        renderOption={any}
      />
      <OptionPicker
        label={t("sortLabel")}
        options={SORTS.map(([value]) => value)}
        value={view.sort}
        onChange={(sort) => onChange({ ...view, sort })}
        renderOption={(option) => t(SORT_LABELS[option])}
      />
    </div>
  );
}
