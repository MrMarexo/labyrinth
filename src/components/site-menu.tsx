"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { Link } from "~/components/link";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { PixelIcon } from "~/components/pixel-icons";
import { SignOutButton } from "~/components/sign-out-button";
import { ThemeToggle } from "~/components/theme-toggle";

/**
 * Everything that is not a destination of its own, behind one header button
 * (spec §10.5): language and theme for anyone, and for a signed-in player
 * their profile and sign-out. On a phone the header has no room for the
 * matches and labyrinths links, so they lead the panel there, ruled off from
 * the rest.
 *
 * The panel stays mounted while closed, only hidden, so the controls keep
 * their state. Escape closes it and returns focus to the button; a click
 * outside closes it without taking focus from whatever was clicked, and
 * following a link in it or signing out closes it too: the header outlives
 * the navigation, so nothing else would.
 */
export function SiteMenu({ signedIn }: { signedIn: boolean }) {
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

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-menu
        data-signed-in={signedIn ? "" : undefined}
        aria-label={t("menu")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="border-border-strong flex size-9 items-center justify-center rounded border"
      >
        <PixelIcon name="menu" className="size-5" />
      </button>
      <div
        id={panelId}
        role="region"
        aria-label={t("menu")}
        data-menu-panel
        hidden={!open}
        className="bg-bg border-border-strong absolute top-full right-0 z-20 mt-2 w-max min-w-48 space-y-3 border-2 p-3 shadow-[4px_4px_0_var(--border-strong)]"
      >
        {signedIn && (
          <>
            <div data-menu-nav className="space-y-3 sm:hidden">
              <nav className="flex flex-col gap-2">
                <Link href="/matches" onClick={close}>
                  {t("matches")}
                </Link>
                <Link href="/labyrinths" onClick={close}>
                  {t("labyrinths")}
                </Link>
              </nav>
              <hr className="border-border" />
            </div>
            <Link href="/profile" onClick={close} className="block text-sm">
              {t("profile")}
            </Link>
          </>
        )}
        <LocaleSwitcher showLabel />
        <ThemeToggle showLabel />
        {signedIn && (
          <>
            <hr className="border-border" />
            <SignOutButton onSignedOut={close} />
          </>
        )}
      </div>
    </div>
  );
}
