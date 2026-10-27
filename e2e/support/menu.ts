import { expect, type Page } from "@playwright/test";

/** Opens the header's menu, where language, theme and sign-out live. */
export async function openMenu(page: Page): Promise<void> {
  const button = page.locator("[data-menu]");
  if ((await button.getAttribute("aria-expanded")) !== "true") {
    await button.click();
  }
  await expect(page.locator("[data-menu-panel]")).toBeVisible();
}

/** Signs out from the menu; `label` is the button's text in the page's language. */
export async function signOut(page: Page, label = "Sign out"): Promise<void> {
  await openMenu(page);
  await page
    .locator("[data-menu-panel]")
    .getByRole("button", { name: label })
    .click();
}

/** The menu button marks a signed-in header, whatever the language. */
export async function expectSignedIn(page: Page): Promise<void> {
  await expect(page.locator("[data-menu]")).toHaveAttribute(
    "data-signed-in",
    "",
  );
}

/**
 * Clicks a header nav link: in the header on a wide screen, in the menu on a
 * phone, where the header has no room for them.
 */
export async function clickNavLink(page: Page, name: string): Promise<void> {
  const inHeader = page
    .locator("[data-header-nav]")
    .getByRole("link", { name, exact: true });
  if (await inHeader.isVisible()) return inHeader.click();
  await openMenu(page);
  await page
    .locator("[data-menu-panel]")
    .getByRole("link", { name, exact: true })
    .click();
}
