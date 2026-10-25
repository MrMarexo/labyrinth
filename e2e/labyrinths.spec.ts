import { expect, type Page } from "@playwright/test";

import { cell, drag, panToCorner } from "./support/board";
import { createMatch, joinMatch, test } from "./support/match";
import { startRunningMatch } from "./support/run";

/** A real tRPC mutation through the page's own session. */
async function mutate(page: Page, procedure: string, input: object) {
  const ok = await page.evaluate(
    async ({ procedure, body }) => {
      const response = await fetch(`/api/trpc/${procedure}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: body }),
      });
      return response.ok;
    },
    { procedure, body: input },
  );
  expect(ok).toBe(true);
}

/** Replaces the player's concept with an empty one. */
function createConcept(
  page: Page,
  input: { name: string; cellCount: number; gateCount: number },
) {
  return mutate(page, "maze.createConcept", { ...input, replace: true });
}

/** A ready, open labyrinth in the player's library. */
function seedSaved(page: Page, input: { name: string; cellCount: number }) {
  return mutate(page, "testSupport.seedMaze", {
    ...input,
    gateCount: 0,
    layout: "open",
  });
}

/** Opens the new-labyrinth form and creates a 36-square, 0-gate one. */
async function createFromForm(page: Page, name: string) {
  await page.getByRole("button", { name: "New labyrinth" }).click();
  await submitForm(page, name);
}

async function submitForm(page: Page, name: string) {
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page
    .getByRole("radiogroup", { name: "Gates" })
    .getByRole("radio", { name: "0", exact: true })
    .click();
  await page.getByRole("button", { name: "Create" }).click();
}

/** Draws a valid 36-square, 0-gate labyrinth on the open editor. */
async function drawValid(page: Page) {
  await panToCorner(page);
  await drag(page, cell(page, 0, 0), cell(page, 11, 0));
  await drag(page, cell(page, 0, 1), cell(page, 11, 1));
  await drag(page, cell(page, 0, 2), cell(page, 11, 2));
  await page.getByRole("radio", { name: "Start", exact: true }).click();
  await cell(page, 0, 0).click();
  await page.getByRole("radio", { name: "Treasure", exact: true }).click();
  await cell(page, 3, 2).click();
  await expect(page.locator("[data-save-state]")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
}

test.describe("/labyrinths", () => {
  test.describe.configure({ timeout: 90_000 });

  test("lists the concept on top and filters the saved ones", async ({
    players,
  }) => {
    // The host's "Host maze" (36 squares, 1 gate) becomes used in the match.
    const { host } = await startRunningMatch(players, createMatch);
    await seedSaved(host, { name: "Wide", cellCount: 64 });
    await createConcept(host, { name: "Sketch", cellCount: 64, gateCount: 0 });

    await host.goto("/en/labyrinths");
    const concept = host.locator("[data-concept] [data-maze-item]");
    await expect(concept).toContainText("Sketch");
    await expect(concept.locator("[data-concept-badge]")).toContainText(
      "Concept",
    );
    // Not counted: only saved labyrinths are.
    await expect(host.getByText("2 / 10 labyrinths")).toBeVisible();

    const items = host.locator("[data-library] [data-maze-item]");
    await expect(items).toHaveCount(2);

    await host.getByRole("radio", { name: "Used" }).click();
    await expect(items).toHaveCount(1);
    await expect(items).toContainText("Host maze");
    await expect(items.locator("[data-used-badge]")).toBeVisible();

    await host.getByRole("radio", { name: "Ready" }).click();
    await expect(items).toHaveCount(1);
    await expect(items).toContainText("Wide");

    await host.getByRole("radio", { name: "Unfinished" }).click();
    await expect(
      host.getByText("No labyrinths match these filters."),
    ).toBeVisible();
    // The concept stays whatever the filter.
    await expect(concept).toBeVisible();

    await host.getByRole("radio", { name: "All" }).click();
    const squares = host.getByLabel("Squares");
    await expect(squares.locator("option")).toHaveText(["Any", "36", "64"]);
    await squares.selectOption("64");
    await expect(items).toHaveCount(1);
    await expect(items).toContainText("Wide");
  });

  test("falls back to any size once the filtered size is gone", async ({
    players,
  }) => {
    const page = await players({ name: "Small", cellCount: 36, gateCount: 0 });
    await seedSaved(page, { name: "Big", cellCount: 64 });
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

  test("at 10, still lets you draw, but not save another", async ({
    players,
  }) => {
    const host = await players({ name: "First", cellCount: 36, gateCount: 0 });
    for (let i = 2; i <= 10; i++) {
      await seedSaved(host, { name: `M${i}`, cellCount: 64 });
    }

    await host.goto("/en/labyrinths");
    await expect(host.getByText("10 / 10 labyrinths")).toBeVisible();
    await expect(
      host.getByText(
        "You have 10 labyrinths, the most you can keep. You can still draw, but delete one before saving another.",
      ),
    ).toBeVisible();

    await createFromForm(host, "Eleventh");
    await expect(host.locator("svg[data-board]")).toBeVisible();
    await drawValid(host);

    await expect(host.locator("[data-save-concept]")).toBeDisabled();
    await expect(
      host.getByText(
        "You have 10 labyrinths, the most you can keep. Delete one to save this one.",
      ),
    ).toBeVisible();
  });
});

test.describe("concepts", () => {
  test.describe.configure({ timeout: 90_000 });

  test("a new labyrinth is a concept until it is saved", async ({
    players,
  }) => {
    const page = await players({ name: "Seed", cellCount: 64, gateCount: 0 });
    await page.goto("/en/labyrinths");
    await createFromForm(page, "Fresh");
    await expect(page.locator("svg[data-board]")).toBeVisible();
    await expect(page.locator("[data-concept-note]")).toBeVisible();

    const save = page.locator("[data-save-concept]");
    await expect(save).toHaveText("Save labyrinth");
    await expect(save).toBeDisabled();
    await drawValid(page);
    await expect(save).toBeEnabled();

    // Autosaved, but not yet among the saved ones.
    const library = page.locator("[data-library] [data-maze-item]");
    await save.click();
    await expect(page).toHaveURL(/\/en\/labyrinths$/);
    await expect(page.locator("[data-concept]")).toHaveCount(0);
    await expect(library).toHaveCount(2);
    await expect(library.filter({ hasText: "Fresh" })).toHaveCount(1);
    await expect(page.getByText("2 / 10 labyrinths")).toBeVisible();
  });

  test("asks before a new labyrinth replaces the concept", async ({
    players,
  }) => {
    const page = await players({ name: "Seed", cellCount: 64, gateCount: 0 });
    await createConcept(page, { name: "Keep me", cellCount: 36, gateCount: 0 });
    // Painted: an empty concept is replaced without asking.
    await page.goto("/en/labyrinths");
    await page.getByRole("link", { name: "Keep me" }).click();
    await panToCorner(page);
    await cell(page, 0, 0).click();
    await expect(page.locator("[data-save-state]")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    await page.goto("/en/labyrinths");

    await createFromForm(page, "Other");
    const dialog = page.locator("dialog[data-replace-concept]");
    await expect(dialog).toContainText(
      "You have a concept in progress, Keep me. If you continue, it will be deleted.",
    );
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/en\/labyrinths$/);

    await page.getByRole("button", { name: "Create" }).click();
    await dialog
      .getByRole("button", { name: "Delete it and continue" })
      .click();
    await expect(page.locator("svg[data-board]")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Other", level: 1 }),
    ).toBeVisible();

    await page.goto("/en/labyrinths");
    await expect(page.locator("[data-concept]")).toContainText("Other");
    await expect(page.getByText("Keep me")).toHaveCount(0);
  });

  test("edits a ready labyrinth through a concept, saved back into it", async ({
    players,
  }) => {
    const page = await players({ name: "Mine", cellCount: 36, gateCount: 0 });
    await page.goto("/en/labyrinths");
    await page.getByRole("link", { name: "Mine" }).click();
    await expect(page.locator("[data-maze-readonly]")).toBeVisible();
    await expect(page.locator("svg[data-board]")).toHaveCount(0);

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator("svg[data-board]")).toBeVisible();
    await expect(page.locator("[data-concept-note]")).toContainText(
      "changes to Mine",
    );
    await panToCorner(page);
    // Moves the treasure: still valid.
    await page.getByRole("radio", { name: "Treasure", exact: true }).click();
    await cell(page, 0, 5).click();
    await expect(page.locator("[data-save-state]")).toHaveAttribute(
      "data-save-state",
      "saved",
    );

    // The library still has one labyrinth, plus the concept.
    await page.goto("/en/labyrinths");
    await expect(page.locator("[data-concept]")).toContainText("Mine");
    await expect(page.locator("[data-library] [data-maze-item]")).toHaveCount(
      1,
    );

    // Edit again: the same concept, no question asked.
    await page
      .locator("[data-library]")
      .getByRole("link", { name: "Mine" })
      .click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator("dialog[data-replace-concept]")).toHaveCount(0);
    await page.locator("[data-save-concept]").click();

    await expect(page).toHaveURL(/\/en\/labyrinths$/);
    await expect(page.locator("[data-concept]")).toHaveCount(0);
    await expect(page.locator("[data-library] [data-maze-item]")).toHaveCount(
      1,
    );
    await expect(page.getByText("1 / 10 labyrinths")).toBeVisible();
  });

  test("edits a used labyrinth as a copy called Edit of …", async ({
    players,
  }) => {
    const { host } = await startRunningMatch(players, createMatch);
    await host.goto("/en/labyrinths");
    await host.getByRole("link", { name: "Host maze" }).click();
    await expect(host.locator("[data-maze-readonly]")).toContainText(
      "Editing makes a copy you can change.",
    );

    await host.getByRole("button", { name: "Edit a copy" }).click();
    await expect(host.locator("svg[data-board]")).toBeVisible();
    await expect(
      host.getByRole("heading", { name: "Edit of Host maze", level: 1 }),
    ).toBeVisible();
    await host.locator("[data-save-concept]").click();

    await expect(host).toHaveURL(/\/en\/labyrinths$/);
    const library = host.locator("[data-library] [data-maze-item]");
    await expect(library).toHaveCount(2);
    await expect(library.filter({ hasText: "Edit of Host maze" })).toHaveCount(
      1,
    );
  });

  test("the lobby offers an unfinished concept to finish, and asks before drawing a new one", async ({
    players,
  }) => {
    const host = await players({ name: "Seed", cellCount: 64, gateCount: 0 });
    const guest = await players({ name: "Other", cellCount: 36, gateCount: 0 });
    const matchId = await createMatch(host, { cells: 36, gates: 0 });
    const lobby = host.url();
    await joinMatch(guest, matchId);
    await createConcept(host, { name: "Half", cellCount: 36, gateCount: 0 });
    await host.goto("/en/labyrinths");
    await host.getByRole("link", { name: "Half" }).click();
    await panToCorner(host);
    await cell(host, 0, 0).click();
    await expect(host.locator("[data-save-state]")).toHaveAttribute(
      "data-save-state",
      "saved",
    );

    await host.goto(lobby);
    await expect(host.locator("[data-maze-option]")).toHaveCount(0);
    const finish = host.locator("[data-continue-concept]");
    await expect(finish).toHaveText("Finish your concept: Half");

    await host.getByRole("button", { name: "Draw a new one" }).click();
    const dialog = host.locator("dialog[data-replace-concept]");
    await expect(dialog).toContainText("Half");
    await dialog.getByRole("button", { name: "Keep it" }).click();

    await finish.click();
    await expect(host).toHaveURL(
      new RegExp(`/en/labyrinths/[^/?]+\\?match=${matchId}$`),
    );
    await expect(host.locator("[data-budget]")).toHaveText("1 / 36 squares");
    await expect(host.locator("[data-use-in-match]")).toBeVisible();
  });
});
