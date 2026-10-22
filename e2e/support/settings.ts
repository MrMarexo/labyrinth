import { expect, type Page } from "@playwright/test";

/** Opens the header's settings menu, where language and theme live. */
export async function openSettings(page: Page): Promise<void> {
  const button = page.locator("[data-settings]");
  if ((await button.getAttribute("aria-expanded")) !== "true") {
    await button.click();
  }
  await expect(page.locator("[data-settings-panel]")).toBeVisible();
}
