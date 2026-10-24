"use client";

import { Key } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { gateColour } from "~/components/editor/gate-colours";
import type { Discovery } from "~/maze";

/** How long a notice stays up; the fade in `globals.css` runs this long. */
const FOUND_MS = 2500;

export type Found = Discovery & { id: number };

/**
 * A short notice over the top of the board when the runner finds a key or a
 * gate. It never takes focus or clicks and goes away on its own, so the run
 * carries on under it. Hidden from screen readers: the view's live region
 * already says what was found.
 */
export function FoundToast({ found }: { found: Found | null }) {
  const t = useTranslations("run");
  const [shown, setShown] = useState<Found | null>(null);

  useEffect(() => {
    if (!found) return;
    setShown(found);
    const timer = setTimeout(() => setShown(null), FOUND_MS);
    return () => clearTimeout(timer);
  }, [found]);

  if (!shown) return null;
  const colour = gateColour(shown.gate);
  return (
    <div
      // A new key per find restarts the fade.
      key={shown.id}
      data-found-toast={shown.kind}
      aria-hidden="true"
      className="bg-bg border-border-strong motion-safe:animate-found-toast pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow"
    >
      {shown.kind === "key" ? (
        <Key aria-hidden="true" className="size-4" style={{ color: colour }} />
      ) : (
        <span
          aria-hidden="true"
          className="inline-block size-3 rounded-full"
          style={{ backgroundColor: colour }}
        />
      )}
      {t(shown.kind === "key" ? "foundKey" : "foundGate")}
    </div>
  );
}
