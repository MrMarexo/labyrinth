import type { SVGProps } from "react";

import { gateColour } from "~/components/editor/gate-colours";
import { PixelIcon } from "~/components/pixel-icons";

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

/** A glyph's box inside its square: `scale` of it, centred. */
function glyphBox(x: number, y: number, size: number, scale = 0.7) {
  const inset = (1 - scale) / 2;
  return {
    x: (x + inset) * size,
    y: (y + inset) * size,
    width: size * scale,
    height: size * scale,
  };
}

/** Keys sit a little smaller than the other markers. */
const KEY_SCALE = 0.55;

export function KeyIcon({
  x,
  y,
  size,
  gate,
  ...rest
}: IconProps & { gate: number }) {
  return (
    <g {...rest} aria-hidden="true">
      <PixelIcon
        name="key"
        {...glyphBox(x, y, size, KEY_SCALE)}
        style={{ color: gateColour(gate) }}
      />
    </g>
  );
}

export function StartIcon({ x, y, size, ...rest }: IconProps) {
  return (
    <g {...rest} aria-hidden="true">
      <PixelIcon name="start" {...glyphBox(x, y, size)} className="text-fg" />
    </g>
  );
}

export function TreasureIcon({ x, y, size, ...rest }: IconProps) {
  return (
    <g {...rest} aria-hidden="true">
      <PixelIcon
        name="treasure"
        {...glyphBox(x, y, size)}
        className="text-fg"
      />
    </g>
  );
}

/** The runner: a person, a little larger than the other markers. */
export function RunnerIcon({ x, y, size, ...rest }: IconProps) {
  const box = {
    x: (x + 0.1) * size,
    y: (y + 0.1) * size,
    width: size * 0.8,
    height: size * 0.8,
  };
  return (
    <g {...rest} aria-hidden="true">
      <PixelIcon name="runner" {...box} className="text-fg" />
    </g>
  );
}

/** The keyhole ring in the middle of a gate, in board pixels. */
const GATE_RING = 6;

/**
 * A gate on the edge from (x1, y1) to (x2, y2): the edge in the gate's
 * colour, broken in the middle by a ring, the same keyhole the palette's gate
 * tool shows. The colour and any dash are set on the `<g>` and inherited, so
 * a hook or test reads them from the root.
 */
export function GateSegment({
  x1,
  y1,
  x2,
  y2,
  gate,
  strokeWidth = 4,
  style,
  ...rest
}: Omit<SVGProps<SVGGElement>, "x1" | "y1" | "x2" | "y2"> & {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  gate: number;
  strokeWidth?: number;
}) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const length = Math.hypot(x2 - x1, y2 - y1);
  // Unit vector along the edge, to stop each half at the ring.
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  return (
    <g
      {...rest}
      strokeLinecap="square"
      fill="none"
      style={{ stroke: gateColour(gate), ...style }}
    >
      <line
        x1={x1}
        y1={y1}
        x2={cx - ux * GATE_RING}
        y2={cy - uy * GATE_RING}
        strokeWidth={strokeWidth}
      />
      <line
        x1={cx + ux * GATE_RING}
        y1={cy + uy * GATE_RING}
        x2={x2}
        y2={y2}
        strokeWidth={strokeWidth}
      />
      <circle cx={cx} cy={cy} r={GATE_RING} strokeWidth={strokeWidth * 0.75} />
    </g>
  );
}
