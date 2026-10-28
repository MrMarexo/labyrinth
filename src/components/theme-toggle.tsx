"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { OptionPicker } from "~/components/option-picker";

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

const CHOICES: readonly Choice[] = ["system", "light", "dark"];

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
    <OptionPicker
      label={t("label")}
      options={CHOICES}
      value={choice}
      onChange={(next) => {
        setChoice(next);
        apply(next);
      }}
      renderOption={(option) => t(option)}
    />
  );
}
