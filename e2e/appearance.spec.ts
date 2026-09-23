import { expect, test } from "@playwright/test";

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

    await page.getByRole("combobox", { name: "Language" }).selectOption("sk");
    await expect(page).toHaveURL(/\/sk$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Labyrint",
    );
  });
});
