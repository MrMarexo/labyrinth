import { expect, test } from "@playwright/test";

import { cell, centre, drag } from "./support/board";
import { signUpAndOpenNewMaze } from "./support/maze";

test.describe("drawing with a swipe", () => {
  test("a drag paints every square it crosses, and one Undo takes back the whole drag", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);

    await drag(page, cell(page, 0, 0), cell(page, 3, 0));
    await expect(page.locator("[data-budget]")).toHaveText("4 / 36 squares");
    for (let x = 0; x < 4; x += 1) {
      await expect(cell(page, x, 0)).toHaveAttribute(
        "aria-label",
        /, painted$/,
      );
    }

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("[data-budget]")).toHaveText("0 / 36 squares");
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  test("a wall drag lays a wall on every edge it follows, and a drag starting on a wall removes them", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    await drag(page, cell(page, 0, 0), cell(page, 5, 0));
    await drag(page, cell(page, 0, 1), cell(page, 5, 1));
    await expect(page.locator("[data-budget]")).toHaveText("12 / 36 squares");

    await page.getByRole("radio", { name: "Wall" }).click();
    const edge = (name: string) => page.locator(`[data-edge="${name}"]`);

    await drag(page, edge("H:1,0"), edge("H:4,0"));
    await expect(page.locator("[data-segment]")).toHaveCount(4);
    for (const x of [1, 2, 3, 4]) {
      await expect(page.locator(`[data-segment="H:${x},0"]`)).toHaveCount(1);
    }

    // Starts on a wall, so the stroke removes -- and carrying on over the
    // empty H:5,0 must not lay a wall there.
    await drag(page, edge("H:3,0"), edge("H:5,0"));
    await expect(page.locator("[data-segment]")).toHaveCount(2);
    await expect(page.locator('[data-segment="H:1,0"]')).toHaveCount(1);
    await expect(page.locator('[data-segment="H:2,0"]')).toHaveCount(1);

    // The removing stroke was one undo step: one Undo brings back both walls.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("[data-segment]")).toHaveCount(4);
    // And the laying stroke was one too: one more Undo clears all four.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("[data-segment]")).toHaveCount(0);
    await expect(page.locator("[data-budget]")).toHaveText("12 / 36 squares");
  });

  test("one eraser drag removes every wall it passes over", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    await drag(page, cell(page, 0, 0), cell(page, 5, 0));
    await drag(page, cell(page, 0, 1), cell(page, 5, 1));

    await page.getByRole("radio", { name: "Wall" }).click();
    const edge = (name: string) => page.locator(`[data-edge="${name}"]`);
    await drag(page, edge("H:0,0"), edge("H:5,0"));
    await expect(page.locator("[data-segment]")).toHaveCount(6);

    await page.getByRole("radio", { name: "Erase", exact: true }).click();
    await drag(page, edge("H:1,0"), edge("H:4,0"));
    await expect(page.locator("[data-segment]")).toHaveCount(2);
    await expect(page.locator('[data-segment="H:0,0"]')).toHaveCount(1);
    await expect(page.locator('[data-segment="H:5,0"]')).toHaveCount(1);
  });

  test("painting stops at the square budget", async ({ page }) => {
    await signUpAndOpenNewMaze(page);
    // 36 squares: fill two rows of 16 and four more, then swipe on.
    await drag(page, cell(page, 0, 0), cell(page, 15, 0));
    await drag(page, cell(page, 0, 1), cell(page, 15, 1));
    await drag(page, cell(page, 0, 2), cell(page, 9, 2));
    await expect(page.locator("[data-budget]")).toHaveText("36 / 36 squares");
    await cell(page, 0, 5).click();
    await expect(page.locator("[data-budget]")).toHaveText("36 / 36 squares");
  });
});

test.describe("the outline", () => {
  test("is drawn around the painted shape, and its edges take no walls", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    await expect(page.locator("[data-outline]")).toHaveCount(0);

    await cell(page, 0, 0).click();
    await expect(page.locator("[data-outline]")).toHaveCount(4);
    await cell(page, 1, 0).click();
    await expect(page.locator("[data-outline]")).toHaveCount(6);

    await page.getByRole("radio", { name: "Wall" }).click();
    // V:0,0 sits between the two squares; H:0,0 is the bottom border.
    await expect(page.locator('[data-edge="V:0,0"]')).toHaveCount(1);
    await expect(page.locator('[data-edge="H:0,0"]')).toHaveCount(0);
    await expect(page.locator("[data-edge]")).toHaveCount(1);
  });
});

test.describe("hover preview", () => {
  test("shows the square the paint tool would fill", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "no hover on touch");
    await signUpAndOpenNewMaze(page);

    const target = await centre(cell(page, 3, 3));
    await page.mouse.move(target.x, target.y);
    const preview = page.locator('[data-hover="paint"]');
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute("data-hover-cell", "3,3");

    // Moving off the board clears it.
    await page.mouse.move(1, 1);
    await expect(page.locator("[data-hover]")).toHaveCount(0);
  });

  test("over an existing wall, the wall tool previews a removal", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "no hover on touch");
    await signUpAndOpenNewMaze(page);
    await drag(page, cell(page, 0, 0), cell(page, 1, 0));
    await page.getByRole("radio", { name: "Wall" }).click();
    const edge = page.locator('[data-edge="V:0,0"]');

    const at = await centre(edge);
    await page.mouse.move(at.x, at.y);
    const preview = page.locator('[data-hover="wall"]');
    await expect(preview).toHaveAttribute("data-hover-edge", "V:0,0");
    await expect(preview).not.toHaveClass(/stroke-danger/);

    await edge.click();
    await expect(page.locator('[data-segment="V:0,0"]')).toHaveCount(1);
    await page.mouse.move(at.x, at.y + 2);
    await expect(preview).toHaveClass(/stroke-danger/);
  });
});

test.describe("focus ring", () => {
  test("keyboard focus draws our ring and suppresses the browser outline", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);

    let landed = false;
    for (let i = 0; i < 30 && !landed; i += 1) {
      await page.keyboard.press("Tab");
      landed = (await page.locator("[data-cell]:focus").count()) > 0;
    }
    expect(landed).toBe(true);

    await expect(page.locator("[data-focus-ring]")).toHaveCount(1);
    const outline = await page
      .locator("[data-cell]:focus")
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("none");

    await page.keyboard.press("Tab");
    await expect(page.locator("[data-focus-ring]")).toHaveCount(0);

    // Keyboard only: focus a click gives draws no ring.
    await cell(page, 4, 4).click();
    await expect(cell(page, 4, 4)).toBeFocused();
    await expect(page.locator("[data-focus-ring]")).toHaveCount(0);
  });
});
