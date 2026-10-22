import { expect } from "@playwright/test";

import { createMatch, test } from "./support/match";

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

    const code = await createMatch(host, { cells: 36, gates: 0 });
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "awaiting_opponent",
    );

    await guest.goto("/en/matches");
    await guest.getByLabel("Join code").fill(code);
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest).toHaveURL(/\/en\/matches\/[^/]+$/);
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
    await host.getByRole("button", { name: "Use it", exact: true }).click();
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
    await guest.getByRole("button", { name: "Use it", exact: true }).click();

    // Since Phase 4 a running match shows the run view in place of the
    // lobby (spec §10.3.1), so `running` is read off the screen that only
    // `MatchScreen` renders for that status — and the server sets it only
    // once both labyrinths are in, which is what the lobby's
    // `data-opponent-submitted` used to show.
    await expect(guest.locator("[data-run-view]")).toBeVisible();
    await host.reload();
    await expect(host.locator("[data-run-view]")).toBeVisible();
  });

  test("a submitted labyrinth opens read-only", async ({ players }) => {
    const host = await players({ name: "One way", ...SIZE });
    const guest = await players({ name: "Theirs", ...SIZE });

    const code = await createMatch(host, { cells: 36, gates: 0 });
    const matchId = host.url().split("/").at(-1)!;
    await guest.goto("/en/matches");
    await guest.getByLabel("Join code").fill(code);
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest).toHaveURL(/\/en\/matches\/[^/]+$/);

    await host.reload();
    await host.locator("[data-maze-option]").first().click();
    await host.getByRole("button", { name: "Use this labyrinth" }).click();
    await host.getByRole("button", { name: "Use it", exact: true }).click();
    await expect(host.locator("[data-you-submitted]")).toHaveAttribute(
      "data-you-submitted",
      "true",
    );

    // Any save attempt at all would mean the editor was mounted. The
    // server's own refusal (`errors.mazeIsSubmitted`) is covered by the
    // match router's integration tests.
    const saves: string[] = [];
    host.on("request", (r) => {
      if (r.url().includes("maze.saveDraft")) saves.push(r.url());
    });

    // The library still lists it, and opens it as a picture, not an editor.
    await host.goto("/en/labyrinths");
    await host.getByRole("link", { name: "One way" }).click();
    const view = host.locator("[data-maze-readonly]");
    await expect(view).toBeVisible();
    await expect(
      view.getByRole("heading", { name: "One way", level: 1 }),
    ).toBeVisible();
    await expect(view).toContainText("36 squares, 0 gates");
    await expect(view).toContainText(
      "This labyrinth has been used in a match, so it can't be edited. You can reuse it in other matches of the same size.",
    );
    expect(await view.locator("[data-outline]").count()).toBeGreaterThan(0);
    await expect(host.locator("svg[data-board]")).toHaveCount(0);
    await expect(host.getByRole("radio", { name: "Erase square" })).toHaveCount(
      0,
    );
    await expect(host.getByRole("button", { name: "Undo" })).toHaveCount(0);

    // A `?match=` link to it changes nothing: still read-only, no use button.
    await host.goto(`${host.url()}?match=${matchId}`);
    await expect(view).toBeVisible();
    await expect(host.locator("[data-use-in-match]")).toHaveCount(0);

    // And back to the list.
    await view.getByRole("link", { name: "Back to your labyrinths" }).click();
    await expect(host).toHaveURL(/\/en\/labyrinths$/);
    expect(saves).toEqual([]);
  });

  test("an unknown join code is refused with a translated message", async ({
    players,
  }) => {
    const player = await players({ name: "Solo", ...SIZE });

    await player.goto("/en/matches");
    await player.getByLabel("Join code").fill("ZZZZZZ");
    await player.getByRole("button", { name: "Join" }).click();

    const error = player.locator("[data-join-error]");
    await expect(error).toBeVisible();
    await expect(error).toHaveText("No match has that code.");
    // The key itself must never reach the person.
    await expect(error).not.toContainText("errors.");
  });

  test("the matches list shows a created match and its code", async ({
    players,
  }) => {
    const player = await players({ name: "Listed", ...SIZE });

    const code = await createMatch(player, { cells: 36, gates: 0 });

    await player.goto("/en/matches");
    const row = player.locator("[data-match-row]").first();
    await expect(row).toHaveAttribute("data-status", "awaiting_opponent");
    await expect(row).toContainText(code);
  });
});
