import { expect, type Page } from "@playwright/test";

import { PASSWORD, uniqueEmail } from "./auth";

export async function signUpAndOpenNewMaze(page: Page): Promise<void> {
  await page.goto("/en/sign-up");
  await page.getByLabel("Name").fill("Test Person");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.goto("/en/labyrinths");
  await page.getByRole("button", { name: "New labyrinth" }).click();
  await page.getByLabel("Name").fill("Test maze");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("svg[data-board]")).toBeVisible();
}
