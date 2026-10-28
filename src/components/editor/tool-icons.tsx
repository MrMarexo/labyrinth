import { PixelIcon, type PixelIconName } from "~/components/pixel-icons";
import type { BrushSize, Tool } from "~/maze";

/**
 * A palette's groups: side by side and wrapping on a phone, where height is
 * scarce, and stacked into one column beside the board on a desktop.
 */
export const PALETTE_ROWS =
  "flex flex-wrap items-center gap-x-3 gap-y-2 lg:flex-col lg:items-start lg:gap-2";
/**
 * Every group after a palette's first: set off by a rule on a phone, where
 * the groups sit in a row, and by nothing in the desktop column.
 */
export const PALETTE_GROUP =
  "border-border-strong flex gap-2 border-l pl-3 lg:border-l-0 lg:pl-0";

/**
 * Palette icons, one per tool. Key, start and treasure are the glyphs the
 * board draws, so a tool looks like what it places.
 */
export function ToolIcon({ tool }: { tool: Tool }) {
  return <PixelIcon name={TOOL_GLYPHS[tool]} className="size-5" />;
}

const TOOL_GLYPHS: Record<Tool, PixelIconName> = {
  move: "move",
  paint: "paint",
  "erase-cell": "erase-cell",
  wall: "wall",
  gate: "gate",
  key: "key",
  start: "start",
  treasure: "treasure",
  erase: "eraser",
};

/** One square, or a 2×2 block of them: the squares a brush stamp covers. */
export function BrushIcon({ size }: { size: BrushSize }) {
  return (
    <PixelIcon name={size === 1 ? "brush-1" : "brush-2"} className="size-5" />
  );
}
