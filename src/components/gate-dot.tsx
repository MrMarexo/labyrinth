import type { ReactNode } from "react";

import { gateColour } from "~/components/editor/gate-colours";

/**
 * A gate as people see it: its colour, never its number. `label` (the
 * number, in a sentence) is kept for screen readers only.
 */
export function GateDot({ gate, label }: { gate: number; label: ReactNode }) {
  return (
    <>
      <span
        aria-hidden="true"
        data-gate-dot={gate}
        className="inline-block size-3 rounded-full align-[-0.1em]"
        style={{ backgroundColor: gateColour(gate) }}
      />
      <span className="sr-only">{label}</span>
    </>
  );
}
