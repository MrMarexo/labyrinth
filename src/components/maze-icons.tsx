import { DoorStairwell, Key, PersonStanding, Trophy } from "lucide-react";
import type { SVGProps } from "react";

import { gateColour } from "~/components/editor/gate-colours";

/**
 * Markers drawn inside one square of a board: the square at `x`, `y` (in
 * cells) of a grid whose squares are `size` pixels. Every extra prop — a
 * `data-*` hook, `opacity`, `pointerEvents` — goes on the root `<g>`, and the
 * whole icon is hidden from the accessibility tree: the board's own labels
 * say what is there.
 */
export type IconProps = Omit<SVGProps<SVGGElement>, "x" | "y"> & {
  x: number;
  y: number;
  size: number;
};

/** A lucide glyph's box inside its square: 70% of it, centred. */
function glyphBox(x: number, y: number, size: number) {
  return {
    x: (x + 0.15) * size,
    y: (y + 0.15) * size,
    width: size * 0.7,
    height: size * 0.7,
  };
}

export function KeyIcon({
  x,
  y,
  size,
  gate,
  ...rest
}: IconProps & { gate: number }) {
  return (
    <g {...rest} aria-hidden="true">
      <Key
        {...glyphBox(x, y, size)}
        aria-hidden="true"
        strokeWidth={2.5}
        style={{ color: gateColour(gate) }}
      />
    </g>
  );
}

export function StartIcon({ x, y, size, ...rest }: IconProps) {
  return (
    <g {...rest} aria-hidden="true">
      <DoorStairwell
        {...glyphBox(x, y, size)}
        aria-hidden="true"
        strokeWidth={2.5}
        className="text-fg"
      />
    </g>
  );
}

export function TreasureIcon({ x, y, size, ...rest }: IconProps) {
  return (
    <g {...rest} aria-hidden="true">
      <Trophy
        {...glyphBox(x, y, size)}
        aria-hidden="true"
        strokeWidth={2.5}
        className="text-fg"
      />
    </g>
  );
}

/**
 * The runner: a person, no disc. A thick stroke in the background colour is
 * drawn under the glyph so the figure stays readable on top of the start
 * door and on any square, without a circle behind it.
 */
export function RunnerIcon({ x, y, size, ...rest }: IconProps) {
  const box = {
    x: (x + 0.1) * size,
    y: (y + 0.1) * size,
    width: size * 0.8,
    height: size * 0.8,
  };
  return (
    <g {...rest} aria-hidden="true">
      <PersonStanding
        {...box}
        aria-hidden="true"
        strokeWidth={5}
        className="text-bg"
      />
      <PersonStanding
        {...box}
        aria-hidden="true"
        strokeWidth={2.5}
        className="text-fg"
      />
    </g>
  );
}
