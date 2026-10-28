import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIBRARY_VIEW,
  filterAndSort,
  sizeOptions,
  type LibraryItem,
} from "~/components/editor/maze-library";

const at = (day: number) => new Date(Date.UTC(2026, 0, day));

const items: LibraryItem[] = [
  {
    id: "a",
    name: "beta",
    cellCount: 64,
    gateCount: 2,
    state: "draft",
    updatedAt: at(3),
  },
  {
    id: "b",
    name: "Alpha",
    cellCount: 36,
    gateCount: 0,
    state: "ready",
    updatedAt: at(1),
  },
  {
    id: "c",
    name: "gamma",
    cellCount: 36,
    gateCount: 2,
    state: "ready",
    updatedAt: at(5),
  },
  {
    id: "d",
    name: "Čerešňa",
    cellCount: 64,
    gateCount: 0,
    state: "ready",
    updatedAt: at(2),
  },
];

const ids = (list: LibraryItem[]) => list.map((i) => i.id);

describe("filterAndSort", () => {
  it("shows everything, last edited first, by default", () => {
    expect(ids(filterAndSort(items, DEFAULT_LIBRARY_VIEW, "en"))).toEqual([
      "c",
      "a",
      "d",
      "b",
    ]);
  });

  it("filters by state", () => {
    const only = (state: "draft" | "ready") =>
      ids(filterAndSort(items, { ...DEFAULT_LIBRARY_VIEW, state }, "en"));
    expect(only("draft")).toEqual(["a"]);
    expect(only("ready")).toEqual(["c", "d", "b"]);
  });

  it("filters by squares and gates together", () => {
    const view = { ...DEFAULT_LIBRARY_VIEW, squares: 64, gates: 0 };
    expect(ids(filterAndSort(items, view, "en"))).toEqual(["d"]);
  });

  it("sorts by name in the reader's language", () => {
    const view = { ...DEFAULT_LIBRARY_VIEW, sort: "name" as const };
    expect(ids(filterAndSort(items, view, "sk"))).toEqual(["b", "a", "d", "c"]);
  });

  it("sorts by size, squares then gates, smallest first", () => {
    const view = { ...DEFAULT_LIBRARY_VIEW, sort: "size" as const };
    expect(ids(filterAndSort(items, view, "en"))).toEqual(["b", "c", "d", "a"]);
  });
});

describe("sizeOptions", () => {
  it("lists only the sizes the player has, each once, ascending", () => {
    expect(sizeOptions(items)).toEqual({ squares: [36, 64], gates: [0, 2] });
  });
});
