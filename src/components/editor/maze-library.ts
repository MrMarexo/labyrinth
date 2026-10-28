import type { MazeState } from "~/maze";

export type LibraryItem = {
  id: string;
  name: string;
  cellCount: number;
  gateCount: number;
  state: MazeState;
  updatedAt: Date;
};

export type LibrarySort = "edited" | "name" | "size";

/** What /labyrinths is narrowed to and ordered by. */
export type LibraryView = {
  /** A concept is always shown, so it is never a filter of its own. */
  state: Exclude<MazeState, "concept"> | "all";
  squares: number | "any";
  gates: number | "any";
  sort: LibrarySort;
};

export const DEFAULT_LIBRARY_VIEW: LibraryView = {
  state: "all",
  squares: "any",
  gates: "any",
  sort: "edited",
};

export function filterAndSort<T extends LibraryItem>(
  items: readonly T[],
  view: LibraryView,
  locale: string,
): T[] {
  const kept = items.filter(
    (i) =>
      (view.state === "all" || i.state === view.state) &&
      (view.squares === "any" || i.cellCount === view.squares) &&
      (view.gates === "any" || i.gateCount === view.gates),
  );
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, locale);
  const compare: Record<LibrarySort, (a: T, b: T) => number> = {
    edited: (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    name: byName,
    size: (a, b) =>
      a.cellCount - b.cellCount || a.gateCount - b.gateCount || byName(a, b),
  };
  return kept.sort(compare[view.sort]);
}

/** The sizes the player actually has, so a filter never names one they don't. */
export function sizeOptions(items: readonly LibraryItem[]): {
  squares: number[];
  gates: number[];
} {
  const sorted = (values: number[]) =>
    [...new Set(values)].sort((a, b) => a - b);
  return {
    squares: sorted(items.map((i) => i.cellCount)),
    gates: sorted(items.map((i) => i.gateCount)),
  };
}
