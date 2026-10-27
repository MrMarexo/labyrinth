import { expect, test } from "@playwright/test";

import { rgbOf } from "./support/colour";
import { signUp, signUpAndOpenNewMaze } from "./support/maze";
import { openMenu } from "./support/menu";

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
    await openMenu(page);
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

    await openMenu(page);
    await page.getByRole("combobox", { name: "Language" }).selectOption("sk");
    await expect(page).toHaveURL(/\/sk$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Labyrint",
    );
  });

  test("the menu opens, switches theme and language, and closes on Escape", async ({
    page,
  }) => {
    await page.goto("/en");
    const button = page.getByRole("button", { name: "Menu" });
    await expect(button).toHaveAttribute("data-menu");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button.locator("svg.lucide-menu")).toHaveCount(1);
    // Closed: the controls are out of the way.
    await expect(page.getByRole("combobox", { name: "Theme" })).toHaveCount(0);

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByRole("region", { name: "Menu" });
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
    await expect(page.getByRole("button", { name: "Ponuka" })).toBeVisible();
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

    await openMenu(page);
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
    const tint = (el: Element) => getComputedStyle(el, "::after").opacity;
    expect(await undo.evaluate(tint)).toBe("0");
    expect(await undo.evaluate((el) => getComputedStyle(el).cursor)).toBe(
      "not-allowed",
    );

    // The tint is an overlay whose opacity alone changes, so the hover never
    // repaints the button.
    const tool = page.getByRole("radio", { name: "Wall" });
    expect(await tool.evaluate(tint)).toBe("0");
    await tool.hover();
    await expect.poll(() => tool.evaluate(tint)).toBe("0.1");
    expect(await tool.evaluate((el) => getComputedStyle(el).cursor)).toBe(
      "pointer",
    );
  });
});

test.describe("editor palette", () => {
  test("tools are icons named for assistive tech, with a tooltip on hover", async ({
    page,
  }, testInfo) => {
    await signUpAndOpenNewMaze(page);
    const gate = page.getByRole("radio", { name: "Gate", exact: true });
    const tooltip = gate.locator("[data-tooltip]");
    await expect(gate.locator("svg")).toBeVisible();

    if (testInfo.project.name === "mobile") {
      await expect(tooltip).toBeHidden();
      return;
    }
    await expect(tooltip).toHaveCSS("opacity", "0");
    await gate.hover();
    await expect(tooltip).toHaveText("Gate");
    await expect(tooltip).toHaveCSS("opacity", "1");
  });
});
