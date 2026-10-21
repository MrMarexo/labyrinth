import type { Locator, Page } from "@playwright/test";

export async function centre(
  target: Locator,
): Promise<{ x: number; y: number }> {
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
