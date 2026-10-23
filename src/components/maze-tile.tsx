import type { ReactNode } from "react";

import { MazePreview, type DrawableMaze } from "~/components/maze-drawing";

/**
 * The tile's frame, for whatever element carries it: a list item on
 * /labyrinths, a radio button in the match picker. Square, the width of its
 * preview. Selection is the border alone — an accent outline, never a fill —
 * so the preview stays readable either way.
 */
export function mazeTileClass({
  selected = false,
  hoverable = false,
}: { selected?: boolean; hoverable?: boolean } = {}): string {
  const base =
    "flex w-40 flex-col gap-2 rounded-lg border-2 p-2 text-left text-sm sm:w-44";
  if (selected) return `${base} border-accent`;
  return hoverable
    ? `${base} border-border hover:border-border-strong`
    : `${base} border-border`;
}

/**
 * What a tile shows inside its frame: the name on top, the preview (or an
 * empty square for a drawing that is not complete), then the caller's extras.
 */
export function MazeTile({
  name,
  maze,
  wrapPreview = (preview) => preview,
  children,
}: {
  /** Plain text in the picker, a link on /labyrinths. */
  name: ReactNode;
  maze: DrawableMaze | null;
  /** Wraps the preview, e.g. in a link; otherwise it is a direct child. */
  wrapPreview?: (preview: ReactNode) => ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      {name}
      {wrapPreview(
        maze ? (
          <MazePreview maze={maze} />
        ) : (
          <div className="bg-cell-void aspect-square w-full rounded" />
        ),
      )}
      {children}
    </>
  );
}
