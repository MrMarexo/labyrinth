"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Pans a board with the wheel, `span` cells across its width. `pan` moves the
 * camera by a delta in cells and says whether it moved; only then is the
 * page kept still, so it scrolls on once the board can go no further.
 * Attached by hand: React's wheel listener is passive and cannot do that.
 */
export function useWheelPan(
  ref: RefObject<Element | null>,
  span: number,
  pan: (dx: number, dy: number) => boolean,
) {
  // Read by the listener, which is attached once.
  const panRef = useRef(pan);
  panRef.current = pan;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (event: Event) => {
      if (!(event instanceof WheelEvent)) return;
      // A trackpad pinch arrives as a wheel with ctrlKey: that is page zoom.
      if (event.ctrlKey) return;
      const width = el.getBoundingClientRect().width;
      if (width === 0) return;
      const toPixels =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
      const sideways = event.shiftKey && event.deltaX === 0;
      const scale = (toPixels * span) / width;
      const dx = (sideways ? event.deltaY : event.deltaX) * scale;
      const dy = (sideways ? 0 : event.deltaY) * scale;
      if (panRef.current(dx, dy)) event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, span]);
}
