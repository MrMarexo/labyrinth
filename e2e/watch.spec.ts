import { expect } from "@playwright/test";

import { GATED_MAZE_ROUTE } from "~/lib/open-maze";

import { createMatch, test } from "./support/match";
import { closeFinishPopup, startRunningMatch, walk } from "./support/run";

// Well under the 60s fallback poll: passing these proves the push.
const PUSH = { timeout: 10_000 };

test.describe("watching and replay", () => {
  test.describe.configure({ timeout: 90_000 });

  test("the author watches the runner live, and the runner sees the badge", async ({
    players,
  }, testInfo) => {
    const { host, guest } = await startRunningMatch(players, createMatch);
    await walk(host, [...GATED_MAZE_ROUTE], testInfo);
    await closeFinishPopup(host);
    await host.locator("a[data-watch-live]").click();
    await expect(host).toHaveURL(/\/watch\?run=opponent$/);
    const view = host.locator("[data-watch-view]");
    await expect(view).toHaveAttribute("data-live", "true");
    await expect(view).toHaveAttribute("data-watch-step", "0");

    await expect(guest.locator("[data-watchers]")).toHaveAttribute(
      "data-watchers",
      "1",
      PUSH,
    );

    await walk(guest, ["S", "S"], testInfo);
    await expect(view).toHaveAttribute("data-watch-step", "2", PUSH);
    await expect(
      host.locator("[data-watch-runner-view] [data-runner-at]"),
    ).toHaveAttribute("data-runner-at", "0,2");

    // Leaving clears the badge.
    await host.goto("/en/matches");
    await expect(guest.locator("[data-watchers]")).toHaveCount(0, PUSH);
  });

  test("watching is refused before your own run is over", async ({
    players,
  }) => {
    const { guest } = await startRunningMatch(players, createMatch);
    await guest.goto(`${new URL(guest.url()).pathname}/watch?run=opponent`);
    await expect(guest.locator("[data-watch-error]")).toContainText(
      "Finish your own run first.",
    );
  });

  test("the lobby moves to the run the moment the opponent submits", async ({
    players,
  }) => {
    const size = { cellCount: 36, gateCount: 1, layout: "gated" as const };
    const host = await players({ name: "Host maze", ...size });
    const guest = await players({ name: "Guest maze", ...size });
    const code = await createMatch(host, { cells: 36, gates: 1 });
    await guest.goto("/en/matches");
    await guest.getByLabel("Join code").fill(code);
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest).toHaveURL(/\/en\/matches\/[^/]+$/);

    // The host's lobby learns of the join without a reload.
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
      PUSH,
    );
    await host.locator("[data-maze-option]").first().click();
    await host.getByRole("button", { name: "Use this labyrinth" }).click();
    await host.getByRole("button", { name: "Use it", exact: true }).click();
    await expect(host.locator("[data-you-submitted]")).toHaveAttribute(
      "data-you-submitted",
      "true",
    );

    await guest.locator("[data-maze-option]").first().click();
    await guest.getByRole("button", { name: "Use this labyrinth" }).click();
    await guest.getByRole("button", { name: "Use it", exact: true }).click();

    await expect(host.locator("[data-run-view]")).toBeVisible(PUSH);
  });

  test("giving up reaches the opponent at once", async ({ players }) => {
    const { host, guest } = await startRunningMatch(players, createMatch);
    await guest.getByRole("button", { name: "Give up" }).click();
    await guest.getByRole("button", { name: "Yes, give up" }).click();
    await expect(host.locator("[data-match-result]")).toHaveAttribute(
      "data-outcome",
      "won",
      PUSH,
    );
  });

  test("a finished run replays, scrubs and plays", async ({
    players,
  }, testInfo) => {
    const { host, guest } = await startRunningMatch(players, createMatch);
    await walk(host, [...GATED_MAZE_ROUTE], testInfo);
    await closeFinishPopup(host);
    await walk(guest, [...GATED_MAZE_ROUTE], testInfo);
    await expect(host.locator("[data-match-result]")).toBeVisible(PUSH);

    await host.locator('a[data-replay-link="mine"]').click();
    const view = host.locator("[data-watch-view]");
    await expect(view).toHaveAttribute("data-live", "false");
    await expect(view).toHaveAttribute("data-watch-length", "11");

    await host.getByLabel("Timeline").fill("3");
    await expect(view).toHaveAttribute("data-watch-step", "3");
    await expect(
      host.locator("[data-watch-runner-view] [data-runner-at]"),
    ).toHaveAttribute("data-runner-at", "0,2");

    await host.getByRole("button", { name: "Play" }).click();
    // 8 moves at four a second.
    await expect(view).toHaveAttribute("data-watch-step", "11", PUSH);
  });
});
