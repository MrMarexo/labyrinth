import { expect, type Page } from "@playwright/test";

import { cell, drag } from "./support/board";
import { createMatch, test } from "./support/match";

/** Joins `code` as `guest`, so the match moves on to `drawing`. */
async function join(guest: Page, code: string): Promise<void> {
  await guest.goto("/en/matches");
  await guest.getByLabel("Join code").fill(code);
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest).toHaveURL(/\/en\/matches\/[^/]+$/);
}

test.describe("the lobby's maze picker", () => {
  test("shows a preview of each option, no status label, and always offers a new one", async ({
    players,
  }) => {
    const host = await players({
      name: "Previewed",
      cellCount: 36,
      gateCount: 0,
    });
    const guest = await players({ name: "Other", cellCount: 36, gateCount: 0 });
    await join(guest, await createMatch(host, { cells: 36, gates: 0 }));

    await host.reload();
    const option = host.locator("[data-maze-option]");
    await expect(option).toHaveCount(1);
    await expect(option).toHaveAccessibleName("Previewed");
    // The thumbnail itself; its icons are svgs nested inside it.
    const preview = option.locator(":scope > svg");
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute("aria-hidden", "true");
    await expect(preview.locator(".lucide-trophy")).toHaveCount(1);
    await expect(option).not.toContainText("Draft");
    await expect(
      host.getByRole("button", { name: "Draw a new one" }),
    ).toBeVisible();
  });

  test("explains an empty list, and still offers a new one", async ({
    players,
  }) => {
    // Seeded at a different size, so nothing fits this match.
    const host = await players({
      name: "Too big",
      cellCount: 64,
      gateCount: 0,
    });
    const guest = await players({ name: "Other", cellCount: 36, gateCount: 0 });
    await join(guest, await createMatch(host, { cells: 36, gates: 0 }));

    await host.reload();
    await expect(
      host.getByText(
        "You don't have any labyrinths you can use for this match.",
      ),
    ).toBeVisible();
    await expect(host.locator("[data-maze-option]")).toHaveCount(0);
    await expect(
      host.getByRole("button", { name: "Draw a new one" }),
    ).toBeVisible();
  });

  test("draws a new labyrinth from the match and uses it there", async ({
    players,
  }) => {
    const host = await players({ name: "Seed", cellCount: 64, gateCount: 0 });
    const guest = await players({ name: "Other", cellCount: 36, gateCount: 0 });
    const code = await createMatch(host, { cells: 36, gates: 0 });
    const matchUrl = host.url();
    const matchId = matchUrl.split("/").at(-1)!;
    await join(guest, code);

    await host.reload();
    await host.getByRole("button", { name: "Draw a new one" }).click();
    await expect(host).toHaveURL(
      new RegExp(`/en/labyrinths/[^/?]+\\?match=${matchId}$`),
    );
    // The match's settings, not the new-labyrinth form's defaults.
    await expect(host.locator("[data-budget]")).toHaveText("0 / 36 squares");
    await expect(host.locator("[data-gates]")).toHaveText("0 / 0 gates");

    const use = host.locator("[data-use-in-match]");
    await expect(use).toBeDisabled();

    // 36 squares, a start and a treasure: a valid 0-gate maze.
    await drag(host, cell(host, 0, 0), cell(host, 15, 0));
    await drag(host, cell(host, 0, 1), cell(host, 15, 1));
    await drag(host, cell(host, 0, 2), cell(host, 3, 2));
    await expect(host.locator("[data-budget]")).toHaveText("36 / 36 squares");
    await host.getByRole("radio", { name: "Start", exact: true }).click();
    await cell(host, 0, 0).click();
    await host.getByRole("radio", { name: "Treasure", exact: true }).click();
    await cell(host, 3, 2).click();
    await expect(host.locator("[data-save-state]")).toHaveAttribute(
      "data-save-state",
      "saved",
    );

    await expect(use).toBeEnabled();
    await expect(use).toHaveText("Use in this match");
    await use.click();
    await expect(
      host.getByText(
        `Use Labyrinth for match ${code} in this match? After that it can't be edited, but you can reuse it in other matches.`,
      ),
    ).toBeVisible();
    await host.getByRole("button", { name: "Use it", exact: true }).click();

    await expect(host).toHaveURL(matchUrl);
    await expect(host.locator("[data-you-submitted]")).toHaveAttribute(
      "data-you-submitted",
      "true",
    );
  });
});

test.describe("the editor's match check", () => {
  test("offers no use button for a match you are not in, or at another size", async ({
    players,
  }) => {
    const host = await players({
      name: "Wrong size",
      cellCount: 64,
      gateCount: 0,
    });
    const guest = await players({ name: "Other", cellCount: 36, gateCount: 0 });
    const outsider = await players({
      name: "Outsider's",
      cellCount: 36,
      gateCount: 0,
    });
    const code = await createMatch(host, { cells: 36, gates: 0 });
    const matchId = host.url().split("/").at(-1)!;
    await join(guest, code);

    /** Opens the player's only labyrinth with `?match=` pointing here. */
    async function openWithMatch(page: Page, name: string) {
      await page.goto("/en/labyrinths");
      await page.getByRole("link", { name }).click();
      await expect(page.locator("svg[data-board]")).toBeVisible();
      await page.goto(`${page.url()}?match=${matchId}`);
      await expect(page.locator("svg[data-board]")).toBeVisible();
      await expect(page.locator("[data-save-state]")).toBeAttached();
    }

    // In the match, but the labyrinth is 64 squares and the match 36.
    await openWithMatch(host, "Wrong size");
    await expect(host.locator("[data-use-in-match]")).toHaveCount(0);

    // The right size, but not their match.
    await openWithMatch(outsider, "Outsider's");
    await expect(outsider.locator("[data-use-in-match]")).toHaveCount(0);
  });
});

test.describe("cancelling a waiting match", () => {
  test("removes it from the list, and its code stops working", async ({
    players,
  }) => {
    const host = await players({ name: "Host", cellCount: 36, gateCount: 0 });
    const guest = await players({ name: "Guest", cellCount: 36, gateCount: 0 });
    const code = await createMatch(host, { cells: 36, gates: 0 });

    await host.goto("/en/matches");
    const row = host.locator("[data-match-row]", {
      has: host.locator(`[data-match-code="${code}"]`),
    });
    await row.locator("[data-cancel-match]").click();
    await expect(
      row.getByText("Cancel this match? The join code will stop working."),
    ).toBeVisible();
    await row.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(row).toHaveCount(0);

    await guest.goto("/en/matches");
    await guest.getByLabel("Join code").fill(code);
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest.locator("[data-join-error]")).toHaveText(
      "No match has that code.",
    );
  });

  test("from the lobby, returns to the matches list", async ({ players }) => {
    const host = await players({ name: "Host", cellCount: 36, gateCount: 0 });
    const code = await createMatch(host, { cells: 36, gates: 0 });

    await host.locator("[data-cancel-match]").click();
    await host.getByRole("button", { name: "Yes, cancel it" }).click();

    await expect(host).toHaveURL(/\/en\/matches$/);
    await expect(host.locator(`[data-match-code="${code}"]`)).toHaveCount(0);
  });
});
