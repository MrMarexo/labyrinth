import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";

import { GATED_MAZE_ROUTE } from "~/lib/open-maze";

import { createMatch, test } from "./support/match";
import { startRunningMatch, walk } from "./support/run";

test.describe("the run", () => {
  // Two sign-ups, two submissions and a wait of up to one 20s poll do not
  // fit in Playwright's default 30s per test.
  test.describe.configure({ timeout: 90_000 });

  test("two players race to the treasure, and the result waits for both", async ({
    players,
  }, testInfo) => {
    const { host, guest } = await startRunningMatch(players, createMatch);

    // The board starts knowing one square.
    await expect(host.locator("[data-run-cell]")).toHaveCount(1);
    await expect(host.locator("[data-runner-at]")).toHaveAttribute(
      "data-runner-at",
      "0,0",
    );
    // The runner is a person icon alone, with no disc behind it.
    await expect(
      host.locator("[data-runner-at] svg.lucide-person-standing"),
    ).not.toHaveCount(0);
    // (The person glyph draws its own head as a circle, so look only for a
    // disc directly under the runner group.)
    await expect(host.locator("[data-runner-at] > circle")).toHaveCount(0);

    const route = [...GATED_MAZE_ROUTE];
    // Down onto the key, then into the wall.
    await walk(host, route.slice(0, 2), testInfo);
    await expect(host.locator('[data-held-key="1"]')).toBeVisible();
    await walk(host, route.slice(2, 3), testInfo);
    await expect(host.locator("[data-penalties]")).toHaveAttribute(
      "data-penalties",
      "1",
    );
    // Attached, not visible: a horizontal SVG <line> has a zero-height
    // bounding box (the stroke is not part of it), so Playwright reports it
    // hidden however thick it is drawn. The class is what paints it.
    const wall = host.locator('[data-run-segment="H:0,2"]');
    await expect(wall).toBeAttached();
    await expect(wall).toHaveClass(/stroke-wall/);

    // Along the wall, through the gate, to the treasure.
    await walk(host, route.slice(3), testInfo);
    await expect(host.locator("[data-run-finished]")).toBeVisible();
    // Withheld: nothing about the guest's run is on the host's screen.
    await expect(host.locator("[data-match-result]")).toHaveCount(0);
    await expect(host.locator('[data-score="opponent"]')).toHaveCount(0);

    // The guest bumps the north boundary first, so the host wins on
    // penalties however the two clocks fell.
    await walk(guest, ["N", ...route], testInfo);
    await expect(guest.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "lost",
    );

    // The host's waiting screen finds out on its next poll.
    await expect(host.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "won",
      { timeout: 30_000 },
    );
    await expect(host.locator("[data-decided-by]")).toHaveAttribute(
      "data-decided-by",
      "penalties",
    );
    await expect(
      host.locator('[data-score="opponent"] [data-penalties]'),
    ).toHaveAttribute("data-penalties", "2");
    await expect(
      host.locator('[data-result-maze="theirs"] [data-path]'),
    ).toHaveAttribute("data-points-count", "11");
    await expect(
      host.locator('[data-result-maze="yours"] [data-path]'),
    ).toHaveAttribute("data-points-count", "11");
    // Paths are a quiet neutral line, and each full maze shows the runner
    // where the path ends — the same person icon as the run board.
    for (const which of ["theirs", "yours"]) {
      const maze = host.locator(`[data-result-maze="${which}"]`);
      await expect(maze.locator("[data-path]")).toHaveClass(/stroke-fg/);
      await expect(
        maze.locator("[data-path-end] svg.lucide-person-standing"),
      ).not.toHaveCount(0);
    }
  });

  test("giving up ends the match for both players", async ({
    players,
  }, testInfo) => {
    const { host, guest } = await startRunningMatch(players, createMatch);
    await walk(guest, ["S"], testInfo);

    await host.getByRole("button", { name: "Give up" }).click();
    await host.getByRole("button", { name: "Yes, give up" }).click();
    await expect(host.locator("[data-match-result]")).toHaveAttribute(
      "data-reason",
      "gaveUp",
    );
    await expect(host.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "lost",
    );

    // The guest is told without doing anything: the open run view polls.
    await expect(guest.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "won",
      { timeout: 30_000 },
    );
  });

  test("the run view passes axe", async ({ players }) => {
    const { host } = await startRunningMatch(players, createMatch);
    const results = await new AxeBuilder({ page: host })
      .include("[data-run-view]")
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
