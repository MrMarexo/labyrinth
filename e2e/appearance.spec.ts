import { expect, test } from "@playwright/test";

import { openSettings } from "./support/settings";

test.describe("appearance", () => {
  test("applies the stored theme before the page paints", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("theme", "dark");
    });

    const themes: (string | null)[] = [];
    await page.exposeFunction("recordTheme", (value: string | null) => {
      themes.push(value);
    });
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        void (
          window as unknown as {
            recordTheme: (v: string | null) => Promise<void>;
          }
        ).recordTheme(document.documentElement.getAttribute("data-theme"));
      });
    });

    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(themes).toEqual(["dark"]);
  });

  test("theme choice survives a reload", async ({ page }) => {
    await page.goto("/en");
    await openSettings(page);
    await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("switching language keeps you on the same page", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Labyrinth",
    );

    await openSettings(page);
    await page.getByRole("combobox", { name: "Language" }).selectOption("sk");
    await expect(page).toHaveURL(/\/sk$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Labyrint",
    );
  });

  test("the settings menu opens, switches theme and language, and closes on Escape", async ({
    page,
  }) => {
    await page.goto("/en");
    const button = page.getByRole("button", { name: "Settings" });
    await expect(button).toHaveAttribute("data-settings");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button.locator("svg.lucide-settings")).toHaveCount(1);
    // Closed: the controls are out of the way.
    await expect(page.getByRole("combobox", { name: "Theme" })).toHaveCount(0);

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByRole("region", { name: "Settings" });
    await expect(panel).toBeVisible();
    await expect(button).toHaveAttribute(
      "aria-controls",
      (await panel.getAttribute("id"))!,
    );

    await panel.getByRole("combobox", { name: "Theme" }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();

    // An outside click closes it too.
    await button.click();
    await expect(panel).toBeVisible();
    // Bottom left: clear of the panel, which can cover the heading on a phone.
    const viewport = page.viewportSize()!;
    await page.mouse.click(5, viewport.height - 5);
    await expect(panel).toBeHidden();

    await button.click();
    await panel.getByRole("combobox", { name: "Language" }).selectOption("sk");
    await expect(page).toHaveURL(/\/sk$/);
    await expect(
      page.getByRole("button", { name: "Nastavenia" }),
    ).toBeVisible();
  });
});
