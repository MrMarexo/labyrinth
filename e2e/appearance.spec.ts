import { expect, test } from "@playwright/test";

import { rgbOf } from "./support/colour";
import { signUp, signUpAndOpenNewMaze } from "./support/maze";
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

  test("accent buttons are near-white in the dark theme and near-black in the light one", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("theme", "dark");
    });
    await signUp(page);
    await page.goto("/en/labyrinths");
    const button = page.getByRole("button", { name: "New labyrinth" });
    await expect(button).toHaveClass(/bg-accent/);

    const dark = await rgbOf(button, "backgroundColor");
    for (const channel of dark) expect(channel).toBeGreaterThan(200);
    // Its label is dark on the white button.
    for (const channel of await rgbOf(button, "color")) {
      expect(channel).toBeLessThan(80);
    }

    await openSettings(page);
    await page.getByRole("combobox", { name: "Theme" }).selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // Polled: the colours transition over 150ms.
    await expect
      .poll(async () => Math.max(...(await rgbOf(button, "backgroundColor"))))
      .toBeLessThan(80);
    await expect
      .poll(async () => Math.min(...(await rgbOf(button, "color"))))
      .toBeGreaterThan(200);
  });
});

test.describe("buttons", () => {
  test("an enabled button tints on hover; a disabled one shows not-allowed and no tint", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "no hover on touch");
    await signUpAndOpenNewMaze(page);

    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeDisabled();
    await undo.hover({ force: true });
    expect(await undo.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
      "none",
    );
    expect(await undo.evaluate((el) => getComputedStyle(el).cursor)).toBe(
      "not-allowed",
    );

    // The tint is present but transparent at rest, at full spread, so hover
    // only fades its colour in rather than growing it from the edges.
    const tool = page.getByRole("radio", { name: "Wall" });
    const shadow = () => tool.evaluate((el) => getComputedStyle(el).boxShadow);
    const spread = (s: string) => /(\d+(?:\.\d+)?)px inset/.exec(s)?.[1];
    const rest = await shadow();
    expect(rest).toContain("rgba(0, 0, 0, 0)");
    expect(Number(spread(rest))).toBeGreaterThan(100);
    await tool.hover();
    await expect.poll(shadow).not.toContain("rgba(0, 0, 0, 0)");
    expect(spread(await shadow())).toBe(spread(rest));
    expect(await tool.evaluate((el) => getComputedStyle(el).cursor)).toBe(
      "pointer",
    );
  });
});
