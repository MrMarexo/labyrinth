import { KeyRound, Trophy } from "lucide-react";
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
      <KeyRound
        {...glyphBox(x, y, size)}
        aria-hidden="true"
        strokeWidth={2.5}
        style={{ color: gateColour(gate) }}
      />
    </g>
  );
}

export function StartIcon({ x, y, size, ...rest }: IconProps) {
  const cx = (x + 0.5) * size;
  const cy = (y + 0.5) * size;
  return (
    <g {...rest} aria-hidden="true">
      <circle cx={cx} cy={cy} r={size * 0.3} className="fill-accent" />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        // At phone width the editor board draws a 40px square in about 20px;
        // this keeps the S near 10px there rather than 7.
        fontSize={size * 0.48}
        fontWeight={700}
        className="fill-on-accent select-none"
      >
        S
      </text>
    </g>
  );
}

/** The cup of lucide's `Trophy` (lucide-react 1.52.0), in its 24-unit box. */
const TROPHY_CUP = "M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z";

export function TreasureIcon({ x, y, size, ...rest }: IconProps) {
  return (
    <g {...rest} aria-hidden="true">
      {/* The cup alone, filled, under the outline: lucide's own cup path,
          since filling the whole icon would also fill the open handles. */}
      <svg {...glyphBox(x, y, size)} viewBox="0 0 24 24" aria-hidden="true">
        <path d={TROPHY_CUP} className="fill-treasure" />
      </svg>
      <Trophy
        {...glyphBox(x, y, size)}
        aria-hidden="true"
        strokeWidth={2.5}
        className="text-treasure-line"
      />
    </g>
  );
}
