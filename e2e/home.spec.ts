import { expect } from "@playwright/test";

import { signedInContext } from "./support/auth";
import { createMatch, test } from "./support/match";

test.describe("the home page", () => {
  test("a new player sees an empty summary and links to start a match or a labyrinth", async ({
    browser,
    request,
    baseURL,
  }) => {
    const context = await signedInContext(browser, request, baseURL!);
    const page = await context.newPage();

    await page.goto("/en");
    const summary = page.locator("[data-home-summary]");
    await expect(summary.locator('[data-stat="played"]')).toContainText("0");
    await expect(summary.locator('[data-stat="saved"]')).toContainText("0");
    await expect(page.locator("[data-current-match]")).toHaveCount(0);

    await page.getByRole("link", { name: "New match" }).click();
    await expect(page).toHaveURL(/\/en\/matches$/);

    await page.goto("/en");
    await page.getByRole("link", { name: "New labyrinth" }).click();
    await expect(page).toHaveURL(/\/en\/labyrinths$/);

    // A labyrinth started but never saved is unfinished work, not nothing.
    await page.getByRole("button", { name: "New labyrinth" }).click();
    await page.getByLabel("Name").fill("Work in progress");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(/\/en\/labyrinths\/[^/]+$/);
    await page.goto("/en");
    await expect(summary.locator('[data-stat="unfinished"]')).toContainText(
      "1",
    );
    await expect(summary.locator('[data-stat="saved"]')).toContainText("0");

    await context.close();
  });

  test("a player in a match sees it on the home page and can continue it", async ({
    players,
  }) => {
    const host = await players({
      name: "Host maze",
      cellCount: 36,
      gateCount: 0,
    });
    const matchId = await createMatch(host, { cells: 36, gates: 0 });

    await host.goto("/en");
    const current = host.locator("[data-current-match]");
    await expect(current).toHaveAttribute("data-current-match", matchId);
    await expect(current).toContainText("Waiting for an opponent");
    await expect(
      host.locator('[data-home-summary] [data-stat="saved"]'),
    ).toContainText("1");

    await current.getByRole("link", { name: "Continue" }).click();
    await expect(host).toHaveURL(new RegExp(`/en/matches/${matchId}$`));
  });

  test("an anonymous visitor sees no summary", async ({ page }) => {
    await page.goto("/en");
    await expect(
      page.getByRole("heading", { name: "Labyrinth" }),
    ).toBeVisible();
    await expect(page.locator("[data-home-summary]")).toHaveCount(0);
  });
});
