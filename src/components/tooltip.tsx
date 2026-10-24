/**
 * A label shown above an icon button while a mouse rests on it, or while it
 * has keyboard focus. Only where the device can hover: on touch there is no
 * way to see it without pressing the button.
 *
 * Purely visual — the button carries the same text as its `aria-label`. Its
 * parent must have the `group` class; buttons are `position: relative`
 * already (globals.css).
 */
export function Tooltip({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      data-tooltip
      className="bg-fg text-bg pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded px-2 py-1 text-xs whitespace-nowrap opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-hover:delay-300 group-focus-visible:opacity-100 [@media(hover:hover)]:block"
    >
      {label}
    </span>
  );
}

/** A square, 44px icon button; `group` for its tooltip. */
export function iconButtonClass(active: boolean): string {
  return active
    ? "group bg-accent text-on-accent inline-flex size-11 items-center justify-center rounded hover:z-10 focus-visible:z-10"
    : "group border-border-strong inline-flex size-11 items-center justify-center rounded border hover:z-10 focus-visible:z-10";
}
