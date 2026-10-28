"use client";

import { useTranslations } from "next-intl";

import { OptionPicker } from "~/components/option-picker";

import type { LibrarySort, LibraryView } from "./maze-library";

const STATE_LABELS = {
  all: "filterAll",
  draft: "filterDrafts",
  ready: "filterReady",
} as const satisfies Record<LibraryView["state"], string>;

const SORT_LABELS = {
  edited: "sortEdited",
  name: "sortName",
  size: "sortSize",
} as const satisfies Record<LibrarySort, string>;

const STATES = Object.keys(STATE_LABELS) as LibraryView["state"][];
const SORTS = Object.keys(SORT_LABELS) as LibrarySort[];

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
        options={STATES}
        value={view.state}
        onChange={(state) => onChange({ ...view, state })}
        renderOption={(option) => t(STATE_LABELS[option])}
      />
      <OptionPicker<number | "any">
        label={t("squares")}
        // The new-labyrinth form on this page has a group of this name too.
        aria-label={t("filterSquaresName")}
        options={["any", ...sizes.squares]}
        value={view.squares}
        onChange={(squares) => onChange({ ...view, squares })}
        renderOption={any}
      />
      <OptionPicker<number | "any">
        label={t("gates")}
        // The new-labyrinth form on this page has a group of this name too.
        aria-label={t("filterGatesName")}
        options={["any", ...sizes.gates]}
        value={view.gates}
        onChange={(gates) => onChange({ ...view, gates })}
        renderOption={any}
      />
      <OptionPicker
        label={t("sortLabel")}
        options={SORTS}
        value={view.sort}
        onChange={(sort) => onChange({ ...view, sort })}
        renderOption={(option) => t(SORT_LABELS[option])}
      />
    </div>
  );
}
