import { expect, test, type Page } from "@playwright/test";

import { signUpAndOpenNewMaze } from "./support/maze";

/** Computed `stroke` of the segment at `edge` (e.g. `"V:0,0"`). */
async function strokeAt(page: Page, edge: string): Promise<string> {
  return page
    .locator(`[data-segment="${edge}"]`)
    .evaluate((el) => getComputedStyle(el).stroke);
}

// A stroke that failed to resolve reads back as the SVG initial value
// `"none"`, not empty — and a regression to solid black is a value equal to
// one of these, not an empty string either. Neither is "just not the wall's
// grey", so both are checked explicitly rather than inferred from the
// gate-vs-wall comparison alone.
const INVALID_GATE_STROKES = new Set([
  "none",
  "",
  "transparent",
  "rgb(0, 0, 0)",
  "rgba(0, 0, 0, 0)",
  "rgba(0, 0, 0, 1)",
]);

/**
 * The actual "distinct hues" claim: two different gates compared to each
 * other, not just to a wall. A fixture that painted every gate the same
 * colour would still satisfy "not the wall's grey" and "not empty" —
 * only a gate-to-gate comparison catches that regression.
 */
async function assertGateStrokesAreDistinctAndResolved(
  page: Page,
): Promise<void> {
  const [gateA, gateB, wall] = await Promise.all([
    strokeAt(page, "V:0,0"),
    strokeAt(page, "V:2,0"),
    strokeAt(page, "H:1,0"),
  ]);

  for (const value of [gateA, gateB]) {
    expect(INVALID_GATE_STROKES.has(value)).toBe(false);
    expect(value).not.toBe(wall);
  }
  expect(gateA).not.toBe(gateB);
}

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

    // Gate colour is set via the `style` attribute (not a presentation
    // attribute) specifically so this resolves in WebKit, which the mobile
    // project runs — a screenshot alone would pass whether gates render in
    // eight hues or all black, since pixel comparison isn't part of this
    // suite.
    await assertGateStrokesAreDistinctAndResolved(page);

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
    // The resolution mechanism doesn't differ by theme, but both themes are
    // screenshotted below, so both get the real assertion too.
    await assertGateStrokesAreDistinctAndResolved(page);
    await board.screenshot({
      path: testInfo.outputPath("gate-colours-dark.png"),
    });
  });
});
