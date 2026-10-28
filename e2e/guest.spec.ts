import { expect, type Page, type TestInfo } from "@playwright/test";

import { PASSWORD, uniqueEmail } from "./support/auth";
import { cell, drag, panToCorner } from "./support/board";
import { expectSignedIn } from "./support/menu";
import { createMatch, joinAsGuest, joinMatch, test } from "./support/match";
import { closeFinishPopup, walk } from "./support/run";

const OPEN = { cellCount: 36, gateCount: 0 } as const;
const GUEST_NAME = /^Guest \d{4}$/;
const GUEST_MAZE = /Labyrinth for match /;
/** Through the host's seeded open 6×6: down the west side, along the south. */
const OPEN_ROUTE = ["S", "S", "S", "S", "S", "E", "E", "E", "E", "E"] as const;
/** Through the guest's drawn 12×3 strip, start to treasure. */
const STRIP_ROUTE = ["E", "E", "E", "S", "S"] as const;

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

/**
 * A guest has no library, so they draw their own labyrinth from the match:
 * the editor must open for them as for a member, with no sign-up notice.
 */
async function drawAndUseAsGuest(
  visitor: Page,
  matchId: string,
): Promise<void> {
  const matchUrl = visitor.url();
  await visitor.reload();
  await visitor.getByRole("button", { name: "Draw a new one" }).click();
  await expect(visitor).toHaveURL(
    new RegExp(`/en/labyrinths/[^/?]+\\?match=${matchId}$`),
  );
  const use = visitor.locator("[data-use-in-match]");
  await expect(use).toBeVisible();
  await expect(visitor.locator("[data-sign-up-notice]")).toHaveCount(0);

  await panToCorner(visitor);
  // 36 squares, a start and a treasure: a valid 0-gate maze.
  for (const y of [0, 1, 2]) {
    await drag(visitor, cell(visitor, 0, y), cell(visitor, 11, y));
  }
  await expect(visitor.locator("[data-budget]")).toHaveText("36 / 36 squares");
  await visitor.getByRole("radio", { name: "Start", exact: true }).click();
  await cell(visitor, 0, 0).click();
  await visitor.getByRole("radio", { name: "Treasure", exact: true }).click();
  await cell(visitor, 3, 2).click();
  await expect(visitor.locator("[data-save-state]")).toHaveAttribute(
    "data-save-state",
    "saved",
  );

  await expect(use).toBeEnabled();
  await use.click();
  await expect(visitor).toHaveURL(matchUrl);
  await expect(visitor.locator("[data-you-submitted]")).toHaveAttribute(
    "data-you-submitted",
    "true",
  );
}

/** A member hosts, `visitor` joins as a guest, both submit and run to the result. */
async function playAsGuest(
  host: Page,
  visitor: Page,
  testInfo: TestInfo,
): Promise<string> {
  const matchId = await createMatch(host, { cells: 36, gates: 0 });
  await joinAsGuest(visitor, matchId);
  await expect(visitor.locator("[data-guest-name]")).toHaveText(GUEST_NAME);

  await drawAndUseAsGuest(visitor, matchId);
  await submitFirstMaze(host);

  await expect(host.locator("[data-run-view]")).toBeVisible();
  await visitor.reload();
  await expect(visitor.locator("[data-run-view]")).toBeVisible();

  await walk(host, STRIP_ROUTE, testInfo);
  await walk(visitor, OPEN_ROUTE, testInfo);
  return matchId;
}

test.describe("guest play", () => {
  test("a visitor plays a whole match as a guest", async ({
    players,
    page,
  }, testInfo) => {
    const host = await players({ name: "Host maze", ...OPEN });
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
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/en/matches", { waitUntil: "networkidle" });
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
    const host = await players({ name: "Host maze", ...OPEN });
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
    await expect(page).toHaveURL(new RegExp(`/en/matches/${matchId}$`));
    await expect(page.locator("[data-guest-name]")).toHaveCount(0);
    await expect(page.locator("[data-match-result]")).toBeVisible();

    await page.goto("/en/matches");
    const yours = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Your matches" }) });
    await expect(
      yours.locator(`[data-match-row] a[href$="/matches/${matchId}"]`),
    ).toBeVisible();

    await page.goto("/en/labyrinths");
    const item = page
      .locator("[data-maze-item]")
      .filter({ hasText: GUEST_MAZE });
    await expect(item.locator("[data-used-badge]")).toBeVisible();
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

    const signIns: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/sign-in/anonymous")) signIns.push(r.url());
    });

    // The visitor has the page open when a member takes the last seat.
    await page.goto(`/en/matches/${filled}/join`);
    const join = page.getByRole("button", { name: "Join as guest" });
    await expect(join).toBeVisible();
    await joinMatch(rival, filled);

    // The batch stream answers 200 and carries the error in its body, and
    // the body is gone once the page moves on, so read it on the way past.
    let joinBody = "";
    await page.route("**/match.join*", async (route) => {
      const response = await route.fetch();
      joinBody = await response.text();
      await route.fulfill({ response, body: joinBody });
    });
    await join.click();
    await expect.poll(() => joinBody).toContain("errors.matchFull");
    await expect(page.locator("[data-guest-name]")).toHaveText(GUEST_NAME);

    await joinAsGuest(page, open);
    expect(signIns).toHaveLength(1);
  });
});
