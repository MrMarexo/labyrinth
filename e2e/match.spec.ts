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
    await host.getByRole("button", { name: "Submit this labyrinth" }).click();
    await host.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(host.locator("[data-you-submitted]")).toHaveAttribute(
      "data-you-submitted",
      "true",
    );
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
    );

    await guest.locator("[data-maze-option]").first().click();
    await guest.getByRole("button", { name: "Submit this labyrinth" }).click();
    await guest.getByRole("button", { name: "Submit", exact: true }).click();

    await expect(guest.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "running",
    );
    await host.reload();
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "running",
    );
    await expect(host.locator("[data-opponent-submitted]")).toHaveAttribute(
      "data-opponent-submitted",
      "true",
    );
  });

  test("a submitted labyrinth can no longer be edited", async ({ players }) => {
    const host = await players({ name: "One way", ...SIZE });
    const guest = await players({ name: "Theirs", ...SIZE });

    const code = await createMatch(host, { cells: 36, gates: 0 });
    await guest.goto("/en/matches");
    await guest.getByLabel("Join code").fill(code);
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest).toHaveURL(/\/en\/matches\/[^/]+$/);

    await host.reload();
    await host.locator("[data-maze-option]").first().click();
    await host.getByRole("button", { name: "Submit this labyrinth" }).click();
    await host.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(host.locator("[data-you-submitted]")).toHaveAttribute(
      "data-you-submitted",
      "true",
    );

    // The library still lists it...
    await host.goto("/en/labyrinths");
    await expect(host.getByRole("link", { name: "One way" })).toBeVisible();

    // ...but the editor must refuse to change it. Merely checking the name
    // is still listed would not prove that — it would pass identically if
    // the editor silently let the edit through. Opening it and attempting a
    // real edit is what actually exercises `errors.mazeIsSubmitted`
    // (`src/server/api/routers/maze.ts`'s `saveDraft`).
    await host.getByRole("link", { name: "One way" }).click();
    await expect(host.locator("svg[data-board]")).toBeVisible();

    // The seeded maze (`openMazeDraft`) has every square already painted,
    // so clicking one with the default "Paint" tool is a no-op that never
    // reaches the network — switch to "Erase square" first so the click is
    // a real edit that triggers the autosave this test is about.
    await host.getByRole("radio", { name: "Erase square" }).click();
    const saveAttempt = host.waitForResponse(
      (r) => r.url().includes("/api/trpc/maze.saveDraft") && r.status() !== 0,
    );
    await host.locator('[data-cell="0,0"]').click();
    await saveAttempt;

    const banner = host.locator("[data-save-error]");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      "This labyrinth has been submitted and can no longer be changed.",
    );
    // Locked: no retry offered, and undo/redo are disabled.
    await expect(host.getByRole("button", { name: "Retry" })).not.toBeVisible();
    await expect(host.getByRole("button", { name: "Undo" })).toBeDisabled();
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
