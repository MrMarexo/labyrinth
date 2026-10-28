import { expect, test } from "@playwright/test";

import { signedInContext } from "./support/auth";
import { clickNavLink } from "./support/menu";

test.describe("navigation", () => {
  // Every other spec that touches the match lifecycle opens straight on
  // `/en/matches` or `/en/labyrinths` — useful for testing what is on those
  // pages, but structurally incapable of proving a signed-in person can ever
  // land on them in the first place. This one starts where a real session
  // starts and reaches both by clicking.
  test("a signed-in person reaches matches and labyrinths from the home page by clicking", async ({
    browser,
    request,
    baseURL,
  }) => {
    const context = await signedInContext(browser, request, baseURL!);
    const page = await context.newPage();

    await page.goto("/en");
    await clickNavLink(page, "Matches");
    await expect(page).toHaveURL(/\/en\/matches$/);

    await page.goto("/en");
    await clickNavLink(page, "Labyrinths");
    await expect(page).toHaveURL(/\/en\/labyrinths$/);

    await context.close();
  });

  test("an anonymous visitor reaches the lobby from the home page, but not the labyrinths", async ({
    page,
  }) => {
    await page.goto("/en");
    await expect(page.getByRole("link", { name: "Labyrinths" })).toHaveCount(0);
    await page.getByRole("link", { name: "Find a match" }).click();
    await expect(page).toHaveURL(/\/en\/matches$/);
  });
});
