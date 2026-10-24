import {
  DoorStairwell,
  Eraser,
  Key,
  Trophy,
  type LucideProps,
} from "lucide-react";
import type { ReactNode } from "react";

import type { BrushSize, Tool } from "~/maze";

/**
 * Palette icons, one per tool. Key, start and treasure are the glyphs the
 * board draws, so a tool looks like what it places. The rest are drawn here
 * on lucide's 24px grid and stroke, so the two sets sit together.
 */
export function ToolIcon({ tool }: { tool: Tool }) {
  const lucide: LucideProps = {
    "aria-hidden": true,
    className: "size-5",
    strokeWidth: 2,
  };
  switch (tool) {
    case "paint":
      return <PaintIcon />;
    case "erase-cell":
      return <EraseCellIcon />;
    case "wall":
      return <WallIcon />;
    case "gate":
      return <GateIcon />;
    case "key":
      return <Key {...lucide} />;
    case "start":
      return <DoorStairwell {...lucide} />;
    case "treasure":
      return <Trophy {...lucide} />;
    default:
      return <Eraser {...lucide} />;
  }
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      {children}
    </svg>
  );
}

/** One square, or a 2×2 block of them: the squares a brush stamp covers. */
export function BrushIcon({ size }: { size: BrushSize }) {
  return (
    <Glyph>
      {size === 1 ? (
        <rect x={7} y={7} width={10} height={10} rx={1.5} />
      ) : (
        <>
          <rect x={3} y={3} width={8} height={8} rx={1.5} />
          <rect x={13} y={3} width={8} height={8} rx={1.5} />
          <rect x={3} y={13} width={8} height={8} rx={1.5} />
          <rect x={13} y={13} width={8} height={8} rx={1.5} />
        </>
      )}
    </Glyph>
  );
}

/** A square with a plus in it. */
function PaintIcon() {
  return (
    <Glyph>
      <rect x={3} y={3} width={18} height={18} rx={2} />
      <path d="M12 8v8M8 12h8" />
    </Glyph>
  );
}

/** A square with a minus in it. */
function EraseCellIcon() {
  return (
    <Glyph>
      <rect x={3} y={3} width={18} height={18} rx={2} />
      <path d="M8 12h8" />
    </Glyph>
  );
}

/** Two faint squares with a thick wall on the edge between them. */
function WallIcon() {
  return (
    <Glyph>
      <rect x={2} y={6} width={20} height={12} rx={2} opacity={0.4} />
      <path d="M12 3v18" strokeWidth={3} />
    </Glyph>
  );
}

/** The wall again, broken by a keyhole: the gate the board draws. */
function GateIcon() {
  return (
    <Glyph>
      <rect x={2} y={6} width={20} height={12} rx={2} opacity={0.4} />
      <path d="M12 3v5M12 16v5" strokeWidth={3} />
      <circle cx={12} cy={12} r={2.5} />
    </Glyph>
  );
}
