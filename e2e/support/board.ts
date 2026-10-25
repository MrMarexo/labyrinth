import { expect, type Locator, type Page } from "@playwright/test";

import { MAX_BOUNDING_BOX as FRAME } from "~/maze";

export async function centre(
  target: Locator,
): Promise<{ x: number; y: number }> {
  // A tool picked below the board may have scrolled its top off screen.
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("target has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press on the centre of `from`, move to the centre of `to`, release. */
export async function drag(
  page: Page,
  from: Locator,
  to: Locator,
): Promise<void> {
  const a = await centre(from);
  const b = await centre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

export const cell = (page: Page, x: number, y: number) =>
  page.locator(`[data-cell="${x},${y}"]`);

export const edge = (page: Page, name: string) =>
  page.locator(`[data-edge="${name}"]`);

async function pair(board: Locator, name: string) {
  const value = await board.getAttribute(name);
  const [x, y] = (value ?? "").split(",").map(Number);
  return { x: x!, y: y! };
}

/** The board's camera, in cells. A drag lands to within a pixel or so. */
export const camera = (board: Locator) => pair(board, "data-camera");

/**
 * The board's window, in squares: 12 along its shorter side on a phone and
 * 24 on a desktop, more along the longer one.
 */
export async function view(board: Locator) {
  const { x, y } = await pair(board, "data-view");
  return { w: x, h: y };
}

/**
 * Where the camera sits panned to the frame's top-left corner. A window
 * wider (or taller) than the frame cannot pan that way at all: it
 * stays centred on the frame.
 */
export function corner({ w, h }: { w: number; h: number }) {
  return { x: Math.min(0, (FRAME - w) / 2), y: Math.min(0, (FRAME - h) / 2) };
}

/**
 * A new labyrinth opens on the middle of the frame. Pans the board to its
 * top-left corner, where the specs draw, with the move tool, then picks the
 * paint tool again.
 */
export async function panToCorner(page: Page): Promise<void> {
  const board = page.locator("svg[data-board]");
  const target = corner(await view(board));
  await page.getByRole("radio", { name: "Move" }).click();
  // The frame is larger than the window, so it may take a few drags, each
  // from near the window's top-left to near its bottom-right.
  for (let i = 0; i < 6; i += 1) {
    const at = await camera(board);
    if (Math.abs(at.x - target.x) < 0.1 && Math.abs(at.y - target.y) < 0.1) {
      break;
    }
    const x = Math.ceil(Math.max(at.x, 0)) + 1;
    const y = Math.ceil(Math.max(at.y, 0)) + 1;
    await drag(page, cell(page, x, y), cell(page, x + 9, y + 9));
  }
  await expect
    .poll(async () => (await camera(board)).y)
    .toBeCloseTo(target.y, 1);
  expect((await camera(board)).x).toBeCloseTo(target.x, 1);
  await page.getByRole("radio", { name: "Paint" }).click();
}
