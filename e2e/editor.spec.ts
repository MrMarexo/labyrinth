import { expect, test } from "@playwright/test";

import { signUpAndOpenNewMaze } from "./support/maze";

test.describe("drawing a labyrinth", () => {
  test("paints squares and counts them against the budget", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);

    await expect(page.locator("[data-budget]")).toHaveText("0 / 36 squares");
    await page.locator('[data-cell="0,0"]').click();
    await page.locator('[data-cell="1,0"]').click();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");

    // Painting the same square again changes nothing.
    await page.locator('[data-cell="1,0"]').click();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");
  });

  test("undo and redo walk the history", async ({ page }) => {
    await signUpAndOpenNewMaze(page);
    await page.locator('[data-cell="0,0"]').click();
    await page.locator('[data-cell="1,0"]').click();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");

    await page.getByRole("button", { name: "Redo" }).click();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");
  });

  test("shows a translated reason while the maze is not valid", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    await page.locator('[data-cell="0,0"]').click();

    const panel = page.locator('[data-validity="invalid"]');
    await expect(panel).toBeVisible();
    // The issue is rendered as copy, never as a raw key.
    await expect(panel).not.toContainText("maze.validate");
    await expect(panel).toContainText("Place a start and a treasure");
  });

  test("a drawing survives a page refresh", async ({ page }) => {
    await signUpAndOpenNewMaze(page);

    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/trpc/maze.saveDraft") && r.status() === 200,
    );
    await page.locator('[data-cell="3,3"]').click();
    await saved;

    await page.reload();
    await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");
  });

  test("the list shows a saved labyrinth and can delete it", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    await page.goto("/en/labyrinths");

    await expect(page.getByRole("link", { name: "Test maze" })).toBeVisible();
    await page.getByRole("button", { name: "Delete Test maze" }).click();
    await expect(page.getByRole("link", { name: "Test maze" })).toHaveCount(0);
  });
});
