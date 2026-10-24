import { expect } from "@playwright/test";

import { GATED_MAZE_ROUTE } from "~/lib/open-maze";

import { createMatch, test } from "./support/match";
import { press, startRunningMatch, walk } from "./support/run";

/** Long enough that anything drawn before it lands was not the server's. */
const SERVER_DELAY_MS = 800;
/** "At once": well inside the delay, with room for a slow CI frame. */
const AT_ONCE = { timeout: 200 };

test.describe("how the run feels", () => {
  test.describe.configure({ timeout: 90_000 });

  test("states the rule, and counts bumps", async ({ players }) => {
    const { host } = await startRunningMatch(players, createMatch);
    await expect(host.locator("[data-run-rule]")).toBeVisible();
    await expect(host.locator("[data-run-rule] strong")).toHaveText(
      "Fewest bumps wins.",
    );
    await expect(host.getByText("Bumps", { exact: true })).toBeVisible();
    await expect(host.getByText("Penalties")).toHaveCount(0);
  });

  test("a known passage moves at once, an unknown edge waits for the server", async ({
    players,
  }, testInfo) => {
    const { host } = await startRunningMatch(players, createMatch);
    await walk(host, ["S"], testInfo);

    let answered = 0;
    await host.route("**/api/trpc/run.move*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SERVER_DELAY_MS));
      await route.continue();
      answered += 1;
    });
    const runner = host.locator("[data-runner-at]");

    // Back north and south again over the edge just walked.
    await press(host, "N", testInfo);
    await expect(runner).toHaveAttribute("data-runner-at", "0,0", AT_ONCE);
    await press(host, "S", testInfo);
    await expect(runner).toHaveAttribute("data-runner-at", "0,1", AT_ONCE);
    expect(answered).toBe(0);
    // A prediction is never a bump.
    await expect(host.locator("[data-penalties]")).toHaveAttribute(
      "data-penalties",
      "0",
    );

    // East of (0,1) has never been tried: the runner leans, but stays put
    // until the server says where it is.
    await press(host, "E", testInfo);
    await expect(host.locator("[data-run-pending]")).toBeAttached();
    await host.waitForTimeout(SERVER_DELAY_MS / 2);
    await expect(runner).toHaveAttribute("data-runner-at", "0,1");
    // No dimming while it waits: the lean is the only cue.
    await expect(runner).toHaveCSS("opacity", "1");
    await expect(runner).toHaveAttribute("data-runner-at", "1,1", {
      timeout: 10_000,
    });
    expect(answered).toBe(3);
    await expect(host.locator("[data-run-pending]")).toHaveCount(0);
    await expect(host.locator("[data-moves]")).toHaveAttribute(
      "data-moves",
      "4",
    );

    // The server agrees with both predictions: a reload shows the same.
    await host.unroute("**/api/trpc/run.move*");
    await host.reload();
    await expect(runner).toHaveAttribute("data-runner-at", "1,1");
    await expect(host.locator("[data-moves]")).toHaveAttribute(
      "data-moves",
      "4",
    );
  });

  test("moves pressed while an unknown edge waits are dropped", async ({
    players,
  }, testInfo) => {
    const { host } = await startRunningMatch(players, createMatch);
    await walk(host, ["S"], testInfo);

    let sent = 0;
    await host.route("**/api/trpc/run.move*", async (route) => {
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, SERVER_DELAY_MS));
      await route.continue();
    });
    const runner = host.locator("[data-runner-at]");

    await press(host, "E", testInfo);
    await expect(host.locator("[data-run-pending]")).toBeAttached();
    // Spammed while the answer is outstanding: none of these may play out
    // once it lands.
    await press(host, "E", testInfo);
    await press(host, "N", testInfo);
    await press(host, "E", testInfo);
    await expect(runner).toHaveAttribute("data-runner-at", "1,1", {
      timeout: 10_000,
    });
    await expect(host.locator("[data-run-pending]")).toHaveCount(0);
    await host.waitForTimeout(SERVER_DELAY_MS * 2);
    expect(sent).toBe(1);
    await expect(runner).toHaveAttribute("data-runner-at", "1,1");
    await expect(host.locator("[data-moves]")).toHaveAttribute(
      "data-moves",
      "2",
    );
    await host.unroute("**/api/trpc/run.move*");
  });

  test("an edge between two explored squares is dashed until tried", async ({
    players,
  }, testInfo) => {
    const { host } = await startRunningMatch(players, createMatch);
    // (0,0) → (0,1) → (1,1) → (1,0): (0,0) and (1,0) are both explored, and
    // the edge between them is not.
    await walk(host, ["S", "E", "N"], testInfo);
    const untested = host.locator('[data-untested="V:0,0"]');
    await expect(untested).toBeAttached();
    await expect(untested).toHaveAttribute("stroke-dasharray", "4 4");
    await expect(untested).toHaveClass(/stroke-wall/);

    await walk(host, ["W"], testInfo);
    await expect(untested).toHaveCount(0);
  });

  test("the start door is drawn faint, so the runner reads on top of it", async ({
    players,
  }) => {
    const { host } = await startRunningMatch(players, createMatch);
    await expect(host.locator("[data-run-start]")).toHaveAttribute(
      "opacity",
      "0.15",
    );
  });

  test("a collected key is drawn faint", async ({ players }, testInfo) => {
    const { host } = await startRunningMatch(players, createMatch);
    await walk(host, ["S", "S"], testInfo);
    await expect(host.locator('[data-collected-key="1"]')).toHaveAttribute(
      "opacity",
      "0.15",
    );
  });

  test("a bump pulses the runner and the wall once, and both settle", async ({
    players,
  }, testInfo) => {
    const { host } = await startRunningMatch(players, createMatch);
    // The pulse lasts about 200ms, too short to poll for reliably; a
    // mutation observer sees it however briefly it is there.
    await host.evaluate(() => {
      const seen = window as unknown as { pulsed?: boolean; swelled?: boolean };
      seen.pulsed = false;
      seen.swelled = false;
      new MutationObserver(() => {
        if (document.querySelector("[data-bump-pulse]")) seen.pulsed = true;
        if (document.querySelector("[data-bump-wall]")) seen.swelled = true;
      }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    });
    await walk(host, ["N"], testInfo);
    await expect
      .poll(() =>
        host.evaluate(() => (window as unknown as { pulsed?: boolean }).pulsed),
      )
      .toBe(true);
    expect(
      await host.evaluate(
        () => (window as unknown as { swelled?: boolean }).swelled,
      ),
    ).toBe(true);
    await expect(host.locator("[data-bump-pulse]")).toHaveCount(0, {
      timeout: 1000,
    });
    // The wall goes back to its normal width rather than staying swollen.
    await expect(host.locator("[data-bump-wall]")).toHaveCount(0, {
      timeout: 1000,
    });
  });

  test("finding a key shows a notice that goes away on its own", async ({
    players,
  }, testInfo) => {
    const { host } = await startRunningMatch(players, createMatch);
    const toast = host.locator("[data-found-toast]");

    // Down onto the key.
    await walk(host, ["S", "S"], testInfo);
    await expect(toast).toHaveAttribute("data-found-toast", "key");
    await expect(toast).toHaveText("Key found");
    // It never gets in the way of the board or the d-pad.
    await expect(toast).toHaveCSS("pointer-events", "none");
    await expect(toast).toHaveCount(0, { timeout: 5000 });

    // Back up and onto it again: already held, nothing new.
    await walk(host, ["N", "S"], testInfo);
    await host.waitForTimeout(300);
    await expect(toast).toHaveCount(0);
  });

  test("bumping a gate shows a notice the first time only", async ({
    players,
  }, testInfo) => {
    const { host } = await startRunningMatch(players, createMatch);
    const toast = host.locator("[data-found-toast]");

    // East along the top, down to the gate without its key.
    await walk(host, ["E", "E", "E", "E", "E", "S", "S", "S"], testInfo);
    await expect(toast).toHaveAttribute("data-found-toast", "gate");
    await expect(toast).toHaveText("Gate found");
    await expect(toast).toHaveCount(0, { timeout: 5000 });

    await walk(host, ["S"], testInfo);
    await host.waitForTimeout(300);
    await expect(toast).toHaveCount(0);
  });

  test("the treasure opens a popup once, which Escape closes", async ({
    players,
  }, testInfo) => {
    const { host } = await startRunningMatch(players, createMatch);
    await walk(host, [...GATED_MAZE_ROUTE], testInfo);

    const popup = host.getByRole("dialog", { name: "You found the treasure!" });
    await expect(popup).toBeVisible();
    await expect(popup.locator("[data-finish-penalties]")).toHaveAttribute(
      "data-finish-penalties",
      "1",
    );
    await expect(popup.locator("[data-finish-time]")).toHaveText(/^\d+:\d\d$/);
    await expect(popup).toContainText(
      "The result is revealed when your opponent finishes or runs out of time.",
    );
    await expect(popup.locator("a[data-finish-watch-live]")).toBeVisible();
    expect(
      await host.evaluate(
        () => document.activeElement?.closest("[data-finish-popup]") !== null,
      ),
    ).toBe(true);
    await expect(host.locator("[data-treasure-reached]")).toHaveAttribute(
      "opacity",
      "0.15",
    );

    await host.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    // The waiting state was under it all along.
    await expect(host.locator("[data-run-finished]")).toBeVisible();

    await host.reload();
    await expect(host.locator("[data-run-finished]")).toBeVisible();
    await expect(host.locator("[data-finish-popup]")).toHaveCount(0);
  });

  test("the last runner home is told the result is ready", async ({
    players,
  }, testInfo) => {
    const { host, guest } = await startRunningMatch(players, createMatch);
    await walk(host, [...GATED_MAZE_ROUTE], testInfo);
    await walk(guest, ["N", ...GATED_MAZE_ROUTE], testInfo);

    const popup = guest.getByRole("dialog", {
      name: "You found the treasure!",
    });
    await expect(popup).toContainText("The result is ready.");
    await expect(popup.locator("[data-finish-penalties]")).toHaveAttribute(
      "data-finish-penalties",
      "2",
    );
    await popup.getByRole("button", { name: "See the result" }).click();
    await expect(popup).toBeHidden();
    await expect(guest.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "lost",
    );
  });

  test("on desktop the controls sit beside the board, on mobile below it", async ({
    players,
  }, testInfo) => {
    const { host } = await startRunningMatch(players, createMatch);
    const board = await host.locator("[data-run-board]").boundingBox();
    const dpad = await host.locator("[data-dpad]").boundingBox();
    const rule = await host.locator("[data-run-rule]").boundingBox();
    expect(board && dpad && rule).toBeTruthy();
    if (testInfo.project.name === "desktop") {
      expect(dpad!.x).toBeGreaterThanOrEqual(board!.x + board!.width);
      expect(rule!.x).toBeGreaterThanOrEqual(board!.x + board!.width);
    } else {
      expect(dpad!.y).toBeGreaterThanOrEqual(board!.y + board!.height);
      expect(rule!.y + rule!.height).toBeLessThanOrEqual(board!.y);
    }
  });

  test("the board keeps its size while it grows, so the d-pad stays put", async ({
    players,
  }, testInfo) => {
    const { host } = await startRunningMatch(players, createMatch);
    const board = host.locator("[data-run-board]");
    const dpad = host.locator("[data-dpad]");
    // Page coordinates, not viewport ones: tapping the d-pad on mobile may
    // scroll the page, which is not the board moving.
    const place = () =>
      Promise.all(
        [board, dpad].map((l) =>
          l.evaluate((e) => {
            const r = e.getBoundingClientRect();
            return {
              x: r.left + window.scrollX,
              y: r.top + window.scrollY,
              width: r.width,
              height: r.height,
            };
          }),
        ),
      );
    const [boardBefore, dpadBefore] = await place();
    // Down the west edge, bump the wall, then east along it: the explored
    // area grows taller first, then wider, never square.
    await walk(host, ["S", "S", "S", "E", "E", "E", "E"], testInfo);
    // Past the 200ms zoom easing.
    await host.waitForTimeout(400);
    expect(await board.getAttribute("viewBox")).not.toBe("-120 -120 280 280");
    const [boardAfter, dpadAfter] = await place();
    expect(boardAfter!.height).toBeCloseTo(boardBefore!.height, 0);
    expect(boardAfter!.width).toBeCloseTo(boardBefore!.width, 0);
    expect(dpadAfter!.y).toBeCloseTo(dpadBefore!.y, 0);
    expect(dpadAfter!.x).toBeCloseTo(dpadBefore!.x, 0);
  });

  test("the board shows at least seven squares each way from the start", async ({
    players,
  }) => {
    const { host } = await startRunningMatch(players, createMatch);
    const viewBox = await host
      .locator("[data-run-board]")
      .getAttribute("viewBox");
    const [, , w, h] = viewBox!.split(" ").map(Number);
    // CELL_PX is 40: seven squares, centred on the runner at the origin.
    expect(viewBox).toBe("-120 -120 280 280");
    expect(w).toBe(h);
  });
});
