import { expect, test } from "@playwright/test";

import { signUpAndOpenNewMaze } from "./support/maze";

test.describe("board keyboard navigation", () => {
  test("tabs into the grid, arrows to a neighbour, activates it, and a mouse click keeps the tab stop in sync", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);

    // Tab forward from the top of the page until focus lands inside the
    // board's cell group. The board is not the first focusable thing on the
    // page (the header has its own controls), so this proves Tab actually
    // reaches the grid rather than assuming a fixed tab-order offset.
    let landed = false;
    for (let i = 0; i < 30 && !landed; i += 1) {
      await page.keyboard.press("Tab");
      landed = (await page.locator("[data-cell]:focus").count()) > 0;
    }
    expect(landed).toBe(true);
    // Exactly one cell is a tab stop (roving tabindex), and until anything
    // moves it, it is the cell the board was seeded with.
    await expect(page.locator('[data-cell="0,0"]')).toBeFocused();

    // Arrow to a neighbour and activate it with the keyboard, not a click.
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-cell="1,0"]')).toBeFocused();
    await expect(page.locator("[data-budget]")).toHaveText("0 / 36 squares");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");

    // A mouse click elsewhere in the grid must move the live tab stop too,
    // not just paint the square under the pointer -- otherwise leaving the
    // grid and tabbing back lands on a cell the mouse never touched.
    await page.locator('[data-cell="5,5"]').click();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");
    await expect(page.locator('[data-cell="5,5"]')).toBeFocused();

    // Leave the cell group forward (into the shape-tool radiogroup that
    // follows the board), then come back with Shift+Tab: focus must return
    // to the clicked cell, never to the stop from before the click.
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-cell]:focus")).toHaveCount(0);
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('[data-cell="5,5"]')).toBeFocused();
  });
});

test.describe("gate colours", () => {
  test("gates render as distinct hues, in both themes", async ({
    page,
  }, testInfo) => {
    await signUpAndOpenNewMaze(page);

    // Paint two full rows so the gates and wall placed below sit on a real
    // boundary rather than empty void, matching how they would actually look.
    for (let x = 0; x < 16; x += 1) {
      await page.locator(`[data-cell="${x},0"]`).click();
      await page.locator(`[data-cell="${x},1"]`).click();
    }

    // All eight gate hues, side by side along the row boundary.
    await page.getByRole("radio", { name: "Gate" }).click();
    for (const x of [0, 2, 4, 6, 8, 10, 12, 14]) {
      await page.locator(`[data-edge="V:${x},0"]`).click();
    }
    await expect(page.locator('[data-segment^="V:"]')).toHaveCount(8);

    // A couple of walls alongside, so the screenshot also shows gate-vs-wall
    // contrast, not just gate-vs-gate.
    await page.getByRole("radio", { name: "Wall" }).click();
    await page.locator('[data-edge="H:1,0"]').click();
    await page.locator('[data-edge="H:3,0"]').click();
    await expect(page.locator('[data-segment^="H:"]')).toHaveCount(2);

    // `testInfo.outputPath` scopes the filename under this test's own
    // output directory, which Playwright keys by project (desktop, mobile)
    // as well as test file and title -- without it, the desktop and mobile
    // projects running this same spec in parallel would race to write the
    // same two hardcoded paths.
    const board = page.locator("svg[data-board]");
    await board.screenshot({
      path: testInfo.outputPath("gate-colours-light.png"),
    });

    await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await board.screenshot({
      path: testInfo.outputPath("gate-colours-dark.png"),
    });
  });
});
