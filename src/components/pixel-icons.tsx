import type { SVGProps } from "react";

import {
  PIXEL_MAPS,
  runsPath,
  type PixelIconName,
} from "~/components/pixel-maps";

export type { PixelIconName };

type Glyph = { width: number; height: number; solid: string; faint: string };

const GLYPHS = Object.fromEntries(
  Object.entries(PIXEL_MAPS).map(([name, map]) => [
    name,
    {
      width: map[0]!.length,
      height: map.length,
      solid: runsPath(map, "#"),
      faint: runsPath(map, "+"),
    },
  ]),
) as Record<PixelIconName, Glyph>;

/**
 * One glyph, hidden from the accessibility tree: whatever carries it — a
 * button's label, a board square's — says what it means. `pixel-icon` and
 * `pixel-icon-<name>` are the hooks a test finds it by. Inside an SVG it
 * nests as an `<svg>` of its own, placed with `x`, `y`, `width` and `height`.
 * At a fixed size, give it a whole multiple of its grid (10px or 20px for
 * the 10-pixel glyphs), or some pixels draw a screen pixel wider than others.
 */
export function PixelIcon({
  name,
  className,
  ...rest
}: SVGProps<SVGSVGElement> & { name: PixelIconName }) {
  const glyph = GLYPHS[name];
  return (
    <svg
      viewBox={`0 0 ${glyph.width} ${glyph.height}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...rest}
      className={`pixel-icon pixel-icon-${name}${className ? ` ${className}` : ""}`}
    >
      <path d={glyph.solid} />
      {glyph.faint && <path d={glyph.faint} opacity={0.4} />}
    </svg>
  );
}
