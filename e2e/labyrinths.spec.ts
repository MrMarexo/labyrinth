import { expect, type Page } from "@playwright/test";

import { createMatch, joinMatch, test } from "./support/match";
import { startRunningMatch } from "./support/run";

/** A real `maze.createDraft` call through the page's own session. */
async function createDraft(
  page: Page,
  input: { name: string; cellCount: number; gateCount: number },
) {
  const ok = await page.evaluate(async (body) => {
    const response = await fetch("/api/trpc/maze.createDraft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: body }),
    });
    return response.ok;
  }, input);
  expect(ok).toBe(true);
}

test.describe("/labyrinths", () => {
  test.describe.configure({ timeout: 90_000 });

  test("filters by state and size, and marks a used labyrinth", async ({
    players,
  }) => {
    // The host's "Host maze" (36 squares, 1 gate) becomes used in the match.
    const { host } = await startRunningMatch(players, createMatch);
    await createDraft(host, { name: "Sketch", cellCount: 64, gateCount: 0 });

    await host.goto("/en/labyrinths");
    const items = host.locator("[data-maze-item]");
    await expect(items).toHaveCount(2);
    await expect(host.getByText("2 / 10 labyrinths")).toBeVisible();

    await host.getByRole("radio", { name: "Used" }).click();
    await expect(items).toHaveCount(1);
    await expect(items).toContainText("Host maze");
    await expect(items.locator("[data-used-badge]")).toBeVisible();

    await host.getByRole("radio", { name: "Drafts" }).click();
    await expect(items).toHaveCount(1);
    await expect(items).toContainText("Sketch");

    await host.getByRole("radio", { name: "Ready" }).click();
    await expect(items).toHaveCount(0);
    await expect(
      host.getByText("No labyrinths match these filters."),
    ).toBeVisible();

    await host.getByRole("radio", { name: "All" }).click();
    const squares = host.getByLabel("Squares");
    await expect(squares.locator("option")).toHaveText(["Any", "36", "64"]);
    await squares.selectOption("64");
    await expect(items).toHaveCount(1);
    await expect(items).toContainText("Sketch");
  });

  test("falls back to any size once the filtered size is gone", async ({
    players,
  }) => {
    const page = await players({ name: "Small", cellCount: 36, gateCount: 0 });
    await createDraft(page, { name: "Big", cellCount: 64, gateCount: 0 });
    await page.goto("/en/labyrinths");

    await page.getByLabel("Squares").selectOption("64");
    await page.getByRole("button", { name: "Delete Big" }).click();
    await page.getByRole("button", { name: "Confirm delete Big" }).click();

    await expect(page.getByLabel("Squares")).toHaveValue("any");
    await expect(page.locator("[data-maze-item]")).toHaveCount(1);
    await expect(page.locator("[data-maze-item]")).toContainText("Small");
  });

  test("deletes a used labyrinth and frees its slot", async ({ players }) => {
    const { host } = await startRunningMatch(players, createMatch);
    await host.goto("/en/labyrinths");
    await expect(host.getByText("1 / 10 labyrinths")).toBeVisible();

    await host.getByRole("button", { name: "Delete Host maze" }).click();
    await expect(
      host.getByText("Past matches keep their results."),
    ).toBeVisible();
    await host
      .getByRole("button", { name: "Confirm delete Host maze" })
      .click();

    await expect(host.locator("[data-maze-item]")).toHaveCount(0);
    await expect(host.getByText("0 / 10 labyrinths")).toBeVisible();
  });

  test("stops offering new labyrinths at 10, here and in a match", async ({
    players,
  }) => {
    const host = await players({ name: "First", cellCount: 36, gateCount: 0 });
    const guest = await players({ name: "Other", cellCount: 36, gateCount: 0 });
    const matchId = await createMatch(host, { cells: 36, gates: 0 });
    await joinMatch(guest, matchId);
    const lobby = host.url();

    for (let i = 2; i <= 10; i++) {
      // At another size, so "Draw a new one" has no empty draft to reuse.
      await createDraft(host, { name: `M${i}`, cellCount: 64, gateCount: 0 });
    }

    await host.goto("/en/labyrinths");
    await expect(host.getByText("10 / 10 labyrinths")).toBeVisible();
    await expect(
      host.getByRole("button", { name: "New labyrinth" }),
    ).toBeDisabled();
    await expect(
      host.getByText(
        "You have 10 labyrinths, the most you can keep. Delete one to draw another.",
      ),
    ).toBeVisible();

    await host.goto(lobby);
    await expect(
      host.getByRole("button", { name: "Draw a new one" }),
    ).toBeDisabled();
    await expect(
      host.getByText(
        "You have 10 labyrinths, the most you can keep. Delete one on the Labyrinths page to draw a new one.",
      ),
    ).toBeVisible();
  });
});
