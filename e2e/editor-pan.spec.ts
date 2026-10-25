import { expect, test } from "@playwright/test";

import { MAX_BOUNDING_BOX as FRAME } from "~/maze";

import { camera, cell, corner, drag, view } from "./support/board";
import { signUpAndOpenNewMaze } from "./support/maze";

test.describe("panning the editor board", () => {
  test("a new labyrinth opens on the middle of the frame", async ({ page }) => {
    await signUpAndOpenNewMaze(page, { centred: true });
    const board = page.locator("svg[data-board]");
    const { w, h } = await view(board);
    const middle = (span: number) =>
      span >= FRAME ? (FRAME - span) / 2 : Math.round((FRAME - span) / 2);
    const at = await camera(board);
    expect(at.x).toBeCloseTo(middle(w), 5);
    expect(at.y).toBeCloseTo(middle(h), 5);
  });

  test("a phone shows 12 squares along the board's shorter side, a desktop 24", async ({
    page,
  }, testInfo) => {
    await signUpAndOpenNewMaze(page, { centred: true });
    const { w, h } = await view(page.locator("svg[data-board]"));
    const short = testInfo.project.name === "mobile" ? 12 : 24;
    expect(Math.min(w, h)).toBeCloseTo(short, 5);
  });

  test("on a desktop the board is wider than it is tall, and fills the space beside the panel", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "a phone gets a square");
    await signUpAndOpenNewMaze(page, { centred: true });
    const board = page.locator("svg[data-board]");
    const { w, h } = await view(board);
    expect(w).toBeGreaterThan(h);
    const box = (await board.boundingBox())!;
    expect(box.width).toBeGreaterThan(box.height);
  });

  test("on a phone turned on its side the board still spans the full width", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page, { centred: true });
    await page.setViewportSize({ width: 844, height: 390 });
    const board = page.locator("svg[data-board]");
    // The page's side padding is 1rem each side.
    await expect
      .poll(async () => (await board.boundingBox())!.width)
      .toBeCloseTo(844 - 32, 0);
    const box = (await board.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(390);
    expect(box.width).toBeGreaterThan(box.height);
  });

  test("the move tool drags the board over the frame, and what comes into view can be painted", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page, { centred: true });
    const board = page.locator("svg[data-board]");
    // Far outside the window, so not even rendered.
    await expect(cell(page, 0, 0)).toHaveCount(0);
    const before = await camera(board);
    const edge = corner(await view(board));
    // Squares well inside the opening window.
    const x = Math.ceil(Math.max(before.x, 0)) + 2;
    const y = Math.ceil(Math.max(before.y, 0)) + 2;

    await page.getByRole("radio", { name: "Move" }).click();
    await drag(page, cell(page, x, y), cell(page, x + 4, y + 4));
    // Four squares up and left, or as far as the frame's edge allows.
    await expect
      .poll(async () => (await camera(board)).y)
      .toBeCloseTo(Math.max(edge.y, before.y - 4), 1);
    expect((await camera(board)).x).toBeCloseTo(
      Math.max(edge.x, before.x - 4),
      1,
    );
    // A pan draws nothing.
    await expect(page.locator("[data-budget]")).toHaveText("0 / 36 squares");

    // The window's top-left square now: only just brought into view.
    const after = await camera(board);
    const fresh = cell(
      page,
      Math.ceil(Math.max(after.x, 0)),
      Math.ceil(Math.max(after.y, 0)),
    );
    await page.getByRole("radio", { name: "Paint" }).click();
    await fresh.click();
    await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");
    await expect(fresh).toHaveAttribute("aria-label", /, painted$/);
  });

  test("the camera stops at the edge of the frame", async ({ page }) => {
    await signUpAndOpenNewMaze(page);
    const board = page.locator("svg[data-board]");

    const edge = corner(await view(board));

    await page.getByRole("radio", { name: "Move" }).click();
    await drag(page, cell(page, 2, 2), cell(page, 10, 10));
    const at = await camera(board);
    expect(at.x).toBeCloseTo(edge.x, 1);
    expect(at.y).toBeCloseTo(edge.y, 1);
  });

  test("arrowing past the window brings the focused square into view", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    const board = page.locator("svg[data-board]");

    await cell(page, 0, 0).focus();
    // To the frame's far edge: further than any window is wide.
    for (let i = 0; i < FRAME - 1; i += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(cell(page, FRAME - 1, 0)).toBeFocused();
    // Wholly on the board, whichever way the camera had to move for it.
    const square = (await cell(page, FRAME - 1, 0).boundingBox())!;
    const box = (await board.boundingBox())!;
    expect(square.x + square.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(square.y).toBeGreaterThanOrEqual(box.y - 1);
  });
});
