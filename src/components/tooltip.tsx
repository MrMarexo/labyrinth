"use client";

import { useEffect, useRef } from "react";

/** How long a mouse rests on a button before its label shows. */
const HOVER_DELAY_MS = 300;

/**
 * A label shown above an icon button while a mouse rests on it, or while it
 * has keyboard focus. Only where the device can hover: on touch there is no
 * way to see it without pressing the button.
 *
 * Purely visual — the button carries the same text as its `aria-label`. It
 * opens as a popover, in the top layer, so no sibling, scrolling panel or
 * disabled (half-transparent) button can cover, clip or fade it.
 */
export function Tooltip({ label }: { label: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const tip = ref.current;
    const button = tip?.parentElement;
    if (!tip || !button) return;
    if (!window.matchMedia("(hover: hover)").matches) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovered = false;

    const show = () => {
      const rect = button.getBoundingClientRect();
      tip.style.left = `${rect.left + rect.width / 2}px`;
      tip.style.top = `${rect.top}px`;
      if (!tip.matches(":popover-open")) tip.showPopover();
    };
    const hide = () => {
      clearTimeout(timer);
      if (tip.matches(":popover-open")) tip.hidePopover();
    };
    const onEnter = () => {
      hovered = true;
      clearTimeout(timer);
      timer = setTimeout(show, HOVER_DELAY_MS);
    };
    const onLeave = () => {
      hovered = false;
      if (!button.matches(":focus-visible")) hide();
    };
    const onFocus = () => {
      if (button.matches(":focus-visible")) show();
    };
    const onBlur = () => {
      if (!hovered) hide();
    };

    button.addEventListener("pointerenter", onEnter);
    button.addEventListener("pointerleave", onLeave);
    button.addEventListener("focus", onFocus);
    button.addEventListener("blur", onBlur);
    // Placed once, on opening: a scroll would leave it behind.
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      button.removeEventListener("pointerenter", onEnter);
      button.removeEventListener("pointerleave", onLeave);
      button.removeEventListener("focus", onFocus);
      button.removeEventListener("blur", onBlur);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-tooltip
      popover="manual"
      className="bg-fg text-bg pixel pointer-events-none fixed inset-auto m-0 -translate-x-1/2 -translate-y-[calc(100%+0.5rem)] overflow-visible border-0 px-2 py-1 text-xs whitespace-nowrap opacity-0 transition-opacity duration-100 open:opacity-100 starting:open:opacity-0"
    >
      {label}
    </span>
  );
}

/** A square, 44px icon button. */
export function iconButtonClass(active: boolean): string {
  return active
    ? "bg-accent text-on-accent inline-flex size-11 items-center justify-center pixel"
    : "border-border-strong inline-flex size-11 items-center justify-center pixel border";
}
