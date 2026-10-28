import { expect, type Page } from "@playwright/test";

import { GATED_MAZE_ROUTE } from "~/lib/open-maze";

import { PASSWORD, uniqueEmail } from "./support/auth";
import { expectSignedIn } from "./support/menu";
import {
  createMatch,
  joinAsGuest,
  joinMatch,
  seedMaze,
  test,
} from "./support/match";
import { closeFinishPopup, walk } from "./support/run";

const GATED = { cellCount: 36, gateCount: 1, layout: "gated" } as const;
const OPEN = { cellCount: 36, gateCount: 0 } as const;
const GUEST_NAME = /^Guest \d{4}$/;

// Sign-ups, two submissions, two runs and a poll do not fit in 30s.
test.describe.configure({ timeout: 120_000 });

async function submitFirstMaze(page: Page): Promise<void> {
  await page.reload();
  await page.locator("[data-maze-option]").first().click();
  await page.getByRole("button", { name: "Use this labyrinth" }).click();
  await page.getByRole("button", { name: "Use it", exact: true }).click();
  await expect(
    page.locator('[data-you-submitted="true"], [data-run-view]').first(),
  ).toBeAttached();
}

/** A member hosts, `visitor` joins as a guest, both submit and run to the result. */
async function playAsGuest(
  host: Page,
  visitor: Page,
  testInfo: Parameters<typeof walk>[2],
): Promise<string> {
  const matchId = await createMatch(host, { cells: 36, gates: 1 });
  await joinAsGuest(visitor, matchId);
  await expect(visitor.locator("[data-guest-name]")).toHaveText(GUEST_NAME);

  await seedMaze(visitor, { name: "Guest maze", ...GATED });
  await visitor.goto(`/en/matches/${matchId}`);
  for (const page of [host, visitor]) await submitFirstMaze(page);

  await host.reload();
  await expect(host.locator("[data-run-view]")).toBeVisible();
  await expect(visitor.locator("[data-run-view]")).toBeVisible();

  const route = [...GATED_MAZE_ROUTE];
  await walk(host, route, testInfo);
  await walk(visitor, ["N", ...route], testInfo);
  return matchId;
}

test.describe("guest play", () => {
  test("a visitor plays a whole match as a guest", async ({
    players,
    page,
  }, testInfo) => {
    const host = await players({ name: "Host maze", ...GATED });
    await playAsGuest(host, page, testInfo);

    for (const side of [page, host]) {
      const result = side.locator("[data-match-result]");
      await expect(result).toBeVisible({ timeout: 30_000 });
      await expect(result.locator('[data-result-maze="theirs"]')).toBeVisible();
      await expect(result.locator('[data-result-maze="yours"]')).toBeVisible();
    }
    await expect(
      host.locator('[data-score="opponent"] th[scope="row"]'),
    ).toHaveText(GUEST_NAME);
  });

  test("a visitor's matches page", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/en/matches");
    await expect(page.locator('[data-sign-up-notice="matches"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create match" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Your matches" }),
    ).toHaveCount(0);
    expect(errors).toHaveLength(0);
  });

  test("a guest's labyrinths page shows only the notice", async ({
    players,
    page,
  }) => {
    const host = await players({ name: "Host maze", ...OPEN });
    const matchId = await createMatch(host, { cells: 36, gates: 0 });
    await joinAsGuest(page, matchId);

    await page.goto("/en/labyrinths");
    await expect(
      page.locator('[data-sign-up-notice="labyrinths"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New labyrinth" }),
    ).toHaveCount(0);
    await expect(page.locator("[data-maze-item]")).toHaveCount(0);
  });

  test("signing up from the result keeps the match", async ({
    players,
    page,
  }, testInfo) => {
    const host = await players({ name: "Host maze", ...GATED });
    const matchId = await playAsGuest(host, page, testInfo);
    await expect(page.locator("[data-match-result]")).toBeVisible({
      timeout: 30_000,
    });

    await closeFinishPopup(page);
    await page
      .getByRole("banner")
      .getByRole("link", { name: "Sign up", exact: true })
      .click();
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expectSignedIn(page);
    await expect(page.locator("[data-guest-name]")).toHaveCount(0);

    await page.goto("/en/matches");
    await expect(
      page.getByRole("heading", { name: "Your matches" }),
    ).toBeVisible();
    await expect(
      page.locator(`[data-match-row] a[href$="/matches/${matchId}"]`),
    ).toBeVisible();

    await page.goto("/en/labyrinths");
    await expect(page.getByText("Guest maze")).toBeVisible();
    await expect(page.locator("[data-used-badge]")).toBeVisible();
  });

  test("a second join after a failed one does not sign in again", async ({
    players,
    page,
  }) => {
    const host = await players({ name: "Host maze", ...OPEN });
    const rival = await players({ name: "Rival maze", ...OPEN });
    const other = await players({ name: "Other maze", ...OPEN });
    const filled = await createMatch(host, { cells: 36, gates: 0 });
    const open = await createMatch(other, { cells: 36, gates: 0 });

    // The visitor has the page open when a member takes the last seat.
    await page.goto(`/en/matches/${filled}/join`);
    const join = page.getByRole("button", { name: "Join as guest" });
    await expect(join).toBeVisible();
    await joinMatch(rival, filled);

    await join.click();
    // The failed join refreshes the preview, which now reads as closed; the
    // inline error shows only until that lands.
    await expect(
      page.locator("[data-lobby-error], [data-match-closed]").first(),
    ).toBeVisible();
    await expect(page.locator("[data-guest-name]")).toHaveText(GUEST_NAME);
    const name = await page.locator("[data-guest-name]").textContent();

    await joinAsGuest(page, open);
    await expect(page.locator("[data-guest-name]")).toHaveText(name!);
  });
});
