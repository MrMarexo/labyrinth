import { expect } from "@playwright/test";

import { createMatch, joinMatch, test } from "./support/match";

const SIZE = { cellCount: 36, gateCount: 0 };

test.describe("match lifecycle", () => {
  test("two accounts create, join, submit, and reach running", async ({
    players,
  }) => {
    // The phase's exit criterion, end to end, as two separate people in two
    // separate browser contexts — not one context switching accounts, which
    // would not prove the ownership boundary holds. `players` owns both
    // contexts and closes them on teardown, pass or fail.
    const host = await players({ name: "Host maze", ...SIZE });
    const guest = await players({ name: "Guest maze", ...SIZE });

    const matchId = await createMatch(host, { cells: 36, gates: 0 });
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "awaiting_opponent",
    );

    await joinMatch(guest, matchId);
    await expect(guest.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
    );

    // Host submits. The match must stay in `drawing` — the runs unlock only
    // when both are in, and a test that checked only the final state would
    // not notice if it unlocked early.
    await host.reload();
    await host.locator("[data-maze-option]").first().click();
    await host.getByRole("button", { name: "Use this labyrinth" }).click();
    await expect(host.locator("[data-you-submitted]")).toHaveAttribute(
      "data-you-submitted",
      "true",
    );
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
    );

    await guest.locator("[data-maze-option]").first().click();
    await guest.getByRole("button", { name: "Use this labyrinth" }).click();

    // Since Phase 4 a running match shows the run view in place of the
    // lobby (spec §10.3.1), so `running` is read off the screen that only
    // `MatchScreen` renders for that status — and the server sets it only
    // once both labyrinths are in, which is what the lobby's
    // `data-opponent-submitted` used to show.
    await expect(guest.locator("[data-run-view]")).toBeVisible();
    await host.reload();
    await expect(host.locator("[data-run-view]")).toBeVisible();
  });

  test("a submitted labyrinth opens in the editor like any saved one", async ({
    players,
  }) => {
    const host = await players({ name: "One way", ...SIZE });
    const guest = await players({ name: "Theirs", ...SIZE });

    const matchId = await createMatch(host, { cells: 36, gates: 0 });
    await joinMatch(guest, matchId);

    await host.reload();
    await host.locator("[data-maze-option]").first().click();
    await host.getByRole("button", { name: "Use this labyrinth" }).click();
    await expect(host.locator("[data-you-submitted]")).toHaveAttribute(
      "data-you-submitted",
      "true",
    );

    // The library still lists it, and opens it for editing as a concept.
    await host.goto("/en/labyrinths");
    await host.getByRole("link", { name: "One way" }).click();
    await expect(host.locator("svg[data-board]")).toBeVisible();
    await expect(
      host.getByRole("heading", { name: "One way", level: 1 }),
    ).toBeVisible();
    await host.goto("/en/labyrinths");
    await expect(host.locator("[data-concept]")).toContainText("One way");
  });

  test("an unknown match's join page says it is no longer open", async ({
    players,
  }) => {
    const player = await players({ name: "Solo", ...SIZE });

    await player.goto("/en/matches/00000000-0000-4000-8000-000000000000/join");

    await expect(player.locator("[data-match-closed]")).toHaveText(
      /This match is no longer open\./,
    );
  });

  test("the matches list shows a created match, without its code", async ({
    players,
  }) => {
    const player = await players({ name: "Listed", ...SIZE });

    const matchId = await createMatch(player, { cells: 36, gates: 0 });

    await player.goto("/en/matches");
    const row = player.locator("[data-match-row]").first();
    await expect(row).toHaveAttribute("data-status", "awaiting_opponent");
    await expect(row).toContainText("36 squares, 0 gates");
    await expect(row.locator("a")).toHaveAttribute(
      "href",
      new RegExp(`/matches/${matchId}$`),
    );
    await expect(player.locator("[data-match-code]")).toHaveCount(0);
  });
});
