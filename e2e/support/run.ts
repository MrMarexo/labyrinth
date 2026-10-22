import { expect, type Page, type TestInfo } from "@playwright/test";

import type { Direction } from "~/maze";

import type { test } from "./match";

const KEY: Record<Direction, string> = {
  N: "ArrowUp",
  E: "ArrowRight",
  S: "ArrowDown",
  W: "ArrowLeft",
};

const BUTTON: Record<Direction, string> = {
  N: "Move north",
  E: "Move east",
  S: "Move south",
  W: "Move west",
};

/**
 * Walks a route one move at a time, waiting for the server to answer each
 * before sending the next, so the spec never depends on the queue's
 * one-waiting-slot policy. The keyboard on desktop, the d-pad on mobile —
 * both input paths get driven by the same specs.
 */
export async function walk(
  page: Page,
  dirs: readonly Direction[],
  testInfo: TestInfo,
): Promise<void> {
  const moves = page.locator("[data-moves]");
  let count = Number(await moves.getAttribute("data-moves"));
  for (const [i, dir] of dirs.entries()) {
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: BUTTON[dir] }).click();
    } else {
      await page.keyboard.press(KEY[dir]);
    }
    count += 1;
    const answered = `[data-moves="${count}"]`;
    // The move that finishes the match swaps the run view for the result
    // before the counter can show it, so the last move alone may be
    // answered by the result appearing instead.
    const last = i === dirs.length - 1;
    await expect(
      page
        .locator(last ? `${answered}, [data-match-result]` : answered)
        .first(),
    ).toBeAttached();
  }
}

type Players = Parameters<Parameters<typeof test>[2]>[0]["players"];

/** Two players in a running 36/1 match, each holding a gated seed. */
export async function startRunningMatch(
  players: Players,
  createMatch: (
    page: Page,
    o: { cells: number; gates: number },
  ) => Promise<string>,
) {
  const size = { cellCount: 36, gateCount: 1, layout: "gated" as const };
  const host = await players({ name: "Host maze", ...size });
  const guest = await players({ name: "Guest maze", ...size });

  const code = await createMatch(host, { cells: 36, gates: 1 });
  await guest.goto("/en/matches");
  await guest.getByLabel("Join code").fill(code);
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest).toHaveURL(/\/en\/matches\/[^/]+$/);

  for (const page of [host, guest]) {
    await page.reload();
    await page.locator("[data-maze-option]").first().click();
    await page.getByRole("button", { name: "Submit this labyrinth" }).click();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    // The click returns before the mutation commits. Without this wait the
    // next step can race it: the guest submits before the host's submission
    // lands, or the host reloads before the guest's does, and the match is
    // still `drawing`. The host's lobby confirms its own submission; the
    // guest's, being second, flips straight to the run view.
    await expect(
      page.locator('[data-you-submitted="true"], [data-run-view]').first(),
    ).toBeAttached();
  }

  await host.reload();
  await expect(host.locator("[data-run-view]")).toBeVisible();
  await expect(guest.locator("[data-run-view]")).toBeVisible();
  return { host, guest };
}

/** Presses one move: the keyboard on desktop, the d-pad on mobile. */
export async function press(
  page: Page,
  dir: Direction,
  testInfo: TestInfo,
): Promise<void> {
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: BUTTON[dir] }).click();
  } else {
    await page.keyboard.press(KEY[dir]);
  }
}

/** Dismisses the popup the treasure opens, which is modal. */
export async function closeFinishPopup(page: Page): Promise<void> {
  const popup = page.locator("[data-finish-popup]");
  await popup.getByRole("button", { name: "Close" }).click();
  await expect(popup).toBeHidden();
}
