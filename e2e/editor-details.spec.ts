import { expect, test, type Page } from "@playwright/test";

import { cell, centre, drag, edge } from "./support/board";
import { signUpAndOpenNewMaze } from "./support/maze";

/** Two full rows of six, so V:0..4 on row 0 are interior edges. */
async function paintTwoRows(page: Page): Promise<void> {
  await drag(page, cell(page, 0, 0), cell(page, 5, 0));
  await drag(page, cell(page, 0, 1), cell(page, 5, 1));
  await expect(page.locator("[data-budget]")).toHaveText("12 / 36 squares");
}

/** The resolved fill of option `n`'s colour swatch. */
async function swatchColour(page: Page, hook: string, n: number) {
  return page
    .locator(`[${hook}="${n}"] [data-swatch]`)
    .evaluate((el) => getComputedStyle(el).fill);
}

test.describe("choosing a gate", () => {
  test("a 2-gate maze offers exactly gates 1 and 2, defaulting to the lowest unplaced", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page, { gates: 2 });
    await paintTwoRows(page);
    await page.getByRole("radio", { name: "Gate", exact: true }).click();

    const options = page.locator("[data-gate-option]");
    await expect(options).toHaveCount(2);
    await expect(page.locator('[data-gate-option="1"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator('[data-gate-option="2"]')).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.locator('[data-gate-option="3"]')).toHaveCount(0);
  });

  test("picking gate 2 and clicking an edge places gate 2 in its colour", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page, { gates: 2 });
    await paintTwoRows(page);
    await page.getByRole("radio", { name: "Gate", exact: true }).click();

    await page.locator('[data-gate-option="2"]').click();
    await expect(page.locator('[data-gate-option="2"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await edge(page, "V:0,0").click();

    const segment = page.locator('[data-segment="V:0,0"]');
    await expect(segment).toHaveAttribute("data-gate", "2");
    const stroke = await segment.evaluate((el) => getComputedStyle(el).stroke);
    expect(stroke).toBe(await swatchColour(page, "data-gate-option", 2));
    expect(stroke).not.toBe(await swatchColour(page, "data-gate-option", 1));

    // The option now says it is placed, and only that one does.
    await expect(page.locator('[data-gate-option="2"]')).toHaveAttribute(
      "aria-label",
      /placed/,
    );
    await expect(page.locator('[data-gate-option="1"]')).not.toHaveAttribute(
      "aria-label",
      /placed/,
    );
  });

  test("a third gate cannot be placed: placing gate 1 again moves it", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page, { gates: 2 });
    await paintTwoRows(page);
    await page.getByRole("radio", { name: "Gate", exact: true }).click();

    await page.locator('[data-gate-option="1"]').click();
    await edge(page, "V:0,0").click();
    await page.locator('[data-gate-option="2"]').click();
    await edge(page, "V:2,0").click();
    await expect(page.locator("[data-segment][data-gate]")).toHaveCount(2);

    await page.locator('[data-gate-option="1"]').click();
    await edge(page, "V:4,0").click();
    await expect(page.locator("[data-segment][data-gate]")).toHaveCount(2);
    await expect(page.locator('[data-segment="V:0,0"]')).toHaveCount(0);
    await expect(page.locator('[data-segment="V:4,0"]')).toHaveAttribute(
      "data-gate",
      "1",
    );
    await expect(page.locator("[data-gates]")).toHaveText("2 / 2 gates");
  });

  test("arrow keys move the choice, like a radio group", async ({ page }) => {
    await signUpAndOpenNewMaze(page, { gates: 2 });
    await paintTwoRows(page);
    await page.getByRole("radio", { name: "Gate", exact: true }).click();

    await page.locator('[data-gate-option="1"]').focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-gate-option="2"]')).toBeFocused();
    await expect(page.locator('[data-gate-option="2"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator('[data-gate-option="2"]')).toHaveAttribute(
      "tabindex",
      "0",
    );
    await expect(page.locator('[data-gate-option="1"]')).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  test("the hover preview uses the chosen gate's colour", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "no hover on touch");
    await signUpAndOpenNewMaze(page, { gates: 2 });
    await paintTwoRows(page);
    await page.getByRole("radio", { name: "Gate", exact: true }).click();
    await page.locator('[data-gate-option="2"]').click();

    const at = await centre(edge(page, "V:1,0"));
    await page.mouse.move(at.x, at.y);
    const preview = page.locator('[data-hover="gate"]');
    await expect(preview).toHaveAttribute("data-hover-edge", "V:1,0");
    const stroke = await preview.evaluate((el) => getComputedStyle(el).stroke);
    expect(stroke).toBe(await swatchColour(page, "data-gate-option", 2));
  });
});

test.describe("the number advances after a placement", () => {
  test("two gate clicks without touching the picker place gates 1 and 2", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page, { gates: 2 });
    await paintTwoRows(page);
    await page.getByRole("radio", { name: "Gate", exact: true }).click();

    await edge(page, "V:0,0").click();
    await expect(page.locator('[data-gate-option="2"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await edge(page, "V:2,0").click();
    await expect(page.locator('[data-segment="V:0,0"]')).toHaveAttribute(
      "data-gate",
      "1",
    );
    await expect(page.locator('[data-segment="V:2,0"]')).toHaveAttribute(
      "data-gate",
      "2",
    );
    // Every number is placed now, so the choice stays where it was.
    await expect(page.locator('[data-gate-option="2"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("two key clicks without touching the picker place keys 1 and 2", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page, { gates: 2 });
    await paintTwoRows(page);
    await page.getByRole("radio", { name: "Key", exact: true }).click();

    await cell(page, 1, 1).click();
    await cell(page, 2, 1).click();
    await expect(page.locator('[data-key="1"]')).toHaveCount(1);
    await expect(page.locator('[data-key="2"]')).toHaveCount(1);
  });

  test("undo does not move the choice", async ({ page }) => {
    await signUpAndOpenNewMaze(page, { gates: 2 });
    await paintTwoRows(page);
    await page.getByRole("radio", { name: "Gate", exact: true }).click();

    await edge(page, "V:0,0").click();
    await expect(page.locator('[data-gate-option="2"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("[data-segment]")).toHaveCount(0);
    await expect(page.locator('[data-gate-option="2"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

test.describe("choosing a key", () => {
  test("picking key 2 and clicking a square places key 2", async ({ page }) => {
    await signUpAndOpenNewMaze(page, { gates: 2 });
    await paintTwoRows(page);
    await page.getByRole("radio", { name: "Key", exact: true }).click();

    await expect(page.locator("[data-key-option]")).toHaveCount(2);
    await expect(page.locator('[data-key-option="1"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.locator('[data-key-option="2"]').click();
    await cell(page, 3, 1).click();

    await expect(page.locator('[data-key="2"]')).toHaveCount(1);
    await expect(page.locator('[data-key="1"]')).toHaveCount(0);
    await expect(page.locator('[data-key-option="2"]')).toHaveAttribute(
      "aria-label",
      /placed/,
    );
  });
});

test.describe("save status", () => {
  test("shows saving after an edit, then saved, then ready once the maze is valid", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page, { gates: 0 });
    const status = page.locator("[data-save-state]");
    await expect(status).toHaveAttribute("role", "status");

    await cell(page, 0, 0).click();
    await expect(status).toHaveAttribute("data-save-state", "saving");
    await expect(status).toContainText("Saving…");
    await expect(status).toHaveAttribute("data-save-state", "saved");
    // Saved, but not valid: the reasons stay, with a small note under them.
    await expect(page.locator('[data-validity="invalid"]')).toBeVisible();
    await expect(status).toHaveText("Concept saved");

    // 36 squares, a start and a treasure: a valid 0-gate maze.
    await drag(page, cell(page, 1, 0), cell(page, 11, 0));
    await drag(page, cell(page, 0, 1), cell(page, 11, 1));
    await drag(page, cell(page, 0, 2), cell(page, 11, 2));
    await expect(page.locator("[data-budget]")).toHaveText("36 / 36 squares");
    await page.getByRole("radio", { name: "Start", exact: true }).click();
    await cell(page, 0, 0).click();
    await page.getByRole("radio", { name: "Treasure", exact: true }).click();
    await cell(page, 3, 2).click();

    await expect(status).toHaveAttribute("data-save-state", "saved");
    await expect(status).toHaveText("This labyrinth is ready.");
    await expect(page.locator('[data-validity="valid"]')).toBeAttached();
  });
});

test.describe("icons", () => {
  test("the start is a stairwell door and the treasure a trophy, both uncoloured", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    await drag(page, cell(page, 0, 0), cell(page, 3, 0));

    await page.getByRole("radio", { name: "Start", exact: true }).click();
    await cell(page, 0, 0).click();
    await page.getByRole("radio", { name: "Treasure", exact: true }).click();
    await cell(page, 3, 0).click();

    const start = page.locator("[data-start]");
    await expect(start.locator("svg.lucide-door-stairwell")).toHaveCount(1);
    await expect(start.locator("circle, text")).toHaveCount(0);
    const treasure = page.locator("[data-treasure]");
    await expect(treasure).toHaveCount(1);
    expect(await treasure.evaluate((el) => el.tagName)).toBe("g");
    await expect(treasure.locator("svg.lucide-trophy")).toHaveCount(1);
    // Only keys and gates carry colour: the start and the treasure are drawn
    // in the text colour.
    for (const icon of [start, treasure]) {
      await expect(icon.locator("svg.lucide")).toHaveClass(/text-fg/);
    }
  });
});

test.describe("gates by colour", () => {
  test("the colour picker and the issues show a gate's colour, not its number", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page, { gates: 2 });
    await paintTwoRows(page);
    await page.getByRole("radio", { name: "Start", exact: true }).click();
    await cell(page, 0, 0).click();
    await page.getByRole("radio", { name: "Treasure", exact: true }).click();
    await cell(page, 5, 1).click();
    await page.getByRole("radio", { name: "Gate", exact: true }).click();

    // The options are named by number for screen readers, but show none.
    const second = page.locator('[data-gate-option="2"]');
    await expect(second).toHaveAccessibleName("Gate 2");
    await expect(second).toHaveText("");

    await second.click();
    await edge(page, "V:0,0").click();
    const issue = page.locator('[data-issue="maze.validate.gateWithoutKey"]');
    await expect(issue).toHaveText("Gate 2 has no key.");
    const dot = issue.locator('[data-gate-dot="2"]');
    await expect(dot).toBeVisible();
    expect(
      await dot.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(await swatchColour(page, "data-gate-option", 2));
    // The number is in the text for assistive tech only.
    await expect(issue.locator(".sr-only")).toHaveText("2");
  });
});
