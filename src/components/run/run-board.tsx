"use client";

import { useTranslations } from "next-intl";

import { CELL_PX } from "~/components/editor/board";
import { gateColour } from "~/components/editor/gate-colours";
import {
  cellKey,
  edgeKey,
  type DiscoveredMap,
  type Point,
  type RevealedSegment,
} from "~/maze";

export type Bump = { segment: RevealedSegment; id: number };

export type RunBoardProps = {
  map: DiscoveredMap;
  at: Point;
  heldKeys: readonly number[];
  bump: Bump | null;
  pending: boolean;
};

/** {o:"H",x,y} sits below (x,y); {o:"V",x,y} sits to its right. */
function segmentLine(segment: RevealedSegment) {
  const horizontal = segment.o === "H";
  return {
    x1: (segment.x + (horizontal ? 0 : 1)) * CELL_PX,
    y1: (segment.y + (horizontal ? 1 : 0)) * CELL_PX,
    x2: (segment.x + 1) * CELL_PX,
    y2: (segment.y + 1) * CELL_PX,
  };
}

/**
 * The runner's own view: only discovered cells and segments are drawn, and
 * everything is hidden from the accessibility tree — the view's live region
 * says what happened. The editor board cannot be reused, since it renders
 * every square (see `editor/board.tsx`).
 */
export function RunBoard({ map, at, heldKeys, bump, pending }: RunBoardProps) {
  const t = useTranslations("run");

  let minX = at.x;
  let maxX = at.x;
  let minY = at.y;
  let maxY = at.y;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const c of map.cells) include(c.x, c.y);
  for (const s of map.segments) {
    include(s.x, s.y);
    include(s.o === "H" ? s.x : s.x + 1, s.o === "H" ? s.y + 1 : s.y);
  }
  minX -= 1;
  minY -= 1;
  maxX += 1;
  maxY += 1;

  const viewBox = `${minX * CELL_PX} ${minY * CELL_PX} ${
    (maxX - minX + 1) * CELL_PX
  } ${(maxY - minY + 1) * CELL_PX}`;

  const drawSegment = (
    segment: RevealedSegment,
    key: string,
    extra: { strokeWidth: number; hook?: boolean },
  ) => {
    const held = segment.kind === "gate" && heldKeys.includes(segment.gate);
    return (
      <line
        key={key}
        data-run-segment={extra.hook ? edgeKey(segment) : undefined}
        aria-hidden="true"
        {...segmentLine(segment)}
        strokeWidth={extra.strokeWidth}
        strokeLinecap="round"
        strokeDasharray={held ? "6 4" : undefined}
        className={segment.kind === "wall" ? "stroke-wall" : undefined}
        style={
          segment.kind === "gate"
            ? { stroke: gateColour(segment.gate) }
            : undefined
        }
      />
    );
  };

  const contents = (
    <>
      {map.cells.map((c) => (
        <g key={cellKey(c)} aria-hidden="true">
          <rect
            data-run-cell={`${c.x},${c.y}`}
            x={c.x * CELL_PX}
            y={c.y * CELL_PX}
            width={CELL_PX}
            height={CELL_PX}
            className="fill-cell-painted stroke-grid-line"
          />
          {c.treasure && (
            <circle
              cx={(c.x + 0.5) * CELL_PX}
              cy={(c.y + 0.5) * CELL_PX}
              r={CELL_PX * 0.3}
              className="fill-danger"
            />
          )}
          {c.key !== undefined && (
            <circle
              cx={(c.x + 0.5) * CELL_PX}
              cy={(c.y + 0.5) * CELL_PX}
              r={CELL_PX * 0.15}
              style={{ fill: gateColour(c.key) }}
            />
          )}
        </g>
      ))}

      <circle
        aria-hidden="true"
        cx={0.5 * CELL_PX}
        cy={0.5 * CELL_PX}
        r={CELL_PX * 0.4}
        strokeWidth={2}
        className="stroke-accent fill-none"
      />

      {map.segments.map((s) =>
        drawSegment(s, `seg-${edgeKey(s)}`, { strokeWidth: 4, hook: true }),
      )}

      {bump && drawSegment(bump.segment, "bump", { strokeWidth: 6 })}

      <circle
        data-runner-at={`${at.x},${at.y}`}
        aria-hidden="true"
        cx={(at.x + 0.5) * CELL_PX}
        cy={(at.y + 0.5) * CELL_PX}
        r={CELL_PX * 0.25}
        className={pending ? "fill-accent opacity-60" : "fill-accent"}
      />
    </>
  );

  return (
    <svg
      data-run-board
      role="img"
      aria-label={t("boardLabel")}
      viewBox={viewBox}
      className="border-border-strong h-auto w-full max-w-[700px] rounded border"
    >
      <rect
        aria-hidden="true"
        x={minX * CELL_PX}
        y={minY * CELL_PX}
        width={(maxX - minX + 1) * CELL_PX}
        height={(maxY - minY + 1) * CELL_PX}
        className="fill-cell-void"
      />
      {bump ? (
        <g key={bump.id} className="motion-safe:animate-shake">
          {contents}
        </g>
      ) : (
        <g>{contents}</g>
      )}
    </svg>
  );
}
