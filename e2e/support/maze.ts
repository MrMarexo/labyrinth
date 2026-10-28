import { expect, type Page } from "@playwright/test";

import { PASSWORD, uniqueEmail } from "./auth";
import { panToCorner } from "./board";
import { expectSignedIn } from "./menu";

export async function signUp(page: Page): Promise<void> {
  await page.goto("/en/sign-up");
  await page.getByLabel("Name").fill("Test Person");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expectSignedIn(page);
}

/**
 * `gates` is the new maze's gate count; the form's default (2) if omitted.
 * Unless `centred`, the board is panned to the frame's top-left corner.
 */
export async function signUpAndOpenNewMaze(
  page: Page,
  options: { gates?: number; centred?: boolean } = {},
): Promise<void> {
  await signUp(page);
  await page.goto("/en/labyrinths");
  await page.getByRole("button", { name: "New labyrinth" }).click();
  await page.getByLabel("Name").fill("Test maze");
  if (options.gates !== undefined) {
    // The form's own picker: the library's filters have a Gates group too.
    await page
      .locator("form")
      .getByRole("radiogroup", { name: "Gates" })
      .getByRole("radio", { name: String(options.gates), exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("svg[data-board]")).toBeVisible();
  if (!options.centred) await panToCorner(page);
}
