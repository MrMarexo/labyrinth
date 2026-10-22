import type { Locator } from "@playwright/test";

/**
 * A computed colour property of `locator` as sRGB 0–255 channels. Chrome
 * reports an `oklch(...)` token as `oklch(...)`, not `rgb(...)`, so the value
 * is painted onto a 1×1 canvas and read back: the browser does the
 * conversion, whichever notation it chose to serialise.
 */
export async function rgbOf(
  locator: Locator,
  property: "backgroundColor" | "stroke" | "color",
): Promise<[number, number, number]> {
  return locator.evaluate((el, prop) => {
    const value = getComputedStyle(el)[prop];
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!] as [number, number, number];
  }, property);
}
