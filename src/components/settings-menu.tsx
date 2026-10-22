"use client";

import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";

/**
 * Language and theme behind one header button (spec §10.5). The panel stays
 * mounted while closed, only hidden, so the controls keep their state.
 * Escape closes it and returns focus to the button; a click outside closes
 * it without taking focus from whatever was clicked.
 */
export function SettingsMenu() {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-settings
        aria-label={t("settings")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="border-border-strong flex size-9 items-center justify-center rounded border"
      >
        <Settings aria-hidden="true" className="size-5" />
      </button>
      <div
        id={panelId}
        role="region"
        aria-label={t("settings")}
        data-settings-panel
        hidden={!open}
        className="bg-bg border-border-strong absolute top-full right-0 z-20 mt-2 w-max space-y-3 rounded border p-3 shadow-lg"
      >
        <LocaleSwitcher showLabel />
        <ThemeToggle showLabel />
      </div>
    </div>
  );
}
