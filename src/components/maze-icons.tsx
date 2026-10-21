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

export function KeyIcon({
  x,
  y,
  size,
  gate,
  ...rest
}: IconProps & { gate: number }) {
  const cx = (x + 0.5) * size;
  const cy = (y + 0.5) * size;
  const u = size / 40;
  return (
    <g
      {...rest}
      aria-hidden="true"
      fill="none"
      strokeWidth={3.5 * u}
      strokeLinecap="round"
      style={{ stroke: gateColour(gate) }}
    >
      {/* The bow, then the shaft, then two teeth hanging off its end. */}
      <circle cx={cx - 7 * u} cy={cy} r={5 * u} />
      <line x1={cx - 2 * u} y1={cy} x2={cx + 12 * u} y2={cy} />
      <line x1={cx + 8 * u} y1={cy} x2={cx + 8 * u} y2={cy + 5 * u} />
      <line x1={cx + 12 * u} y1={cy} x2={cx + 12 * u} y2={cy + 5 * u} />
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

export function TreasureIcon({ x, y, size, ...rest }: IconProps) {
  const left = x * size;
  const top = y * size;
  const u = size / 40;
  return (
    <g {...rest} aria-hidden="true" strokeWidth={1.5 * u}>
      {/* Body, then the rounded lid on top of it, then the latch. */}
      <rect
        x={left + 9 * u}
        y={top + 19 * u}
        width={22 * u}
        height={12 * u}
        rx={1.5 * u}
        className="fill-treasure stroke-wall"
      />
      <path
        d={`M ${left + 9 * u} ${top + 19 * u} V ${top + 15 * u} Q ${left + 9 * u} ${top + 10 * u} ${left + 14 * u} ${top + 10 * u} H ${left + 26 * u} Q ${left + 31 * u} ${top + 10 * u} ${left + 31 * u} ${top + 15 * u} V ${top + 19 * u} Z`}
        className="fill-treasure stroke-wall"
      />
      <rect
        x={left + 18 * u}
        y={top + 16 * u}
        width={4 * u}
        height={6 * u}
        rx={1 * u}
        className="fill-treasure-ink"
      />
    </g>
  );
}
