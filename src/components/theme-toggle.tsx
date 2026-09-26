"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type Choice = "system" | "light" | "dark";

function apply(choice: Choice) {
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  try {
    if (choice === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", choice);
  } catch {
    // Site data blocked; the choice applies for this page view only.
  }
}

export function ThemeToggle() {
  const t = useTranslations("theme");
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") setChoice(stored);
    } catch {
      // Ignore; "system" is the correct fallback.
    }
  }, []);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t("label")}</span>
      <select
        aria-label={t("label")}
        className="border-border-strong bg-bg rounded border px-2 py-1"
        value={choice}
        onChange={(event) => {
          const next = event.target.value as Choice;
          setChoice(next);
          apply(next);
        }}
      >
        <option value="system">{t("system")}</option>
        <option value="light">{t("light")}</option>
        <option value="dark">{t("dark")}</option>
      </select>
    </label>
  );
}
