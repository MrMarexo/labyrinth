import { expect, test, type Page } from "@playwright/test";

import { signUp, signUpAndOpenNewMaze } from "./support/maze";

test.describe("creating a labyrinth", () => {
  test("a whitespace-only name fails visibly instead of silently", async ({
    page,
  }) => {
    await signUp(page);
    await page.goto("/en/labyrinths");
    await page.getByRole("button", { name: "New labyrinth" }).click();
    // Passes the browser's `required`, which only rejects a truly empty
    // value, but the server trims and rejects it — this must not be the
    // "nothing happens at all" case the bare `error.message` path produced.
    await page.getByLabel("Name").fill("   ");
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.locator("[data-create-error]")).toBeVisible();
  });
});

test.describe("drawing a labyrinth", () => {
  test("paints squares and counts them against the budget", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);

    await expect(page.locator("[data-budget]")).toHaveText("0 / 36 squares");
    await page.locator('[data-cell="0,0"]').click();
    await page.locator('[data-cell="1,0"]').click();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");

    // Painting the same square again changes nothing.
    await page.locator('[data-cell="1,0"]').click();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");
  });

  test("undo and redo walk the history", async ({ page }) => {
    await signUpAndOpenNewMaze(page);
    await page.locator('[data-cell="0,0"]').click();
    await page.locator('[data-cell="1,0"]').click();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");

    await page.getByRole("button", { name: "Redo" }).click();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");
  });

  test("shows a translated reason while the maze is not valid", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    await page.locator('[data-cell="0,0"]').click();

    const panel = page.locator('[data-validity="invalid"]');
    await expect(panel).toBeVisible();
    // The issue is rendered as copy, never as a raw key.
    await expect(panel).not.toContainText("maze.validate");
    await expect(panel).toContainText("Place a start and a treasure");
  });

  test("a drawing survives a page refresh", async ({ page }) => {
    await signUpAndOpenNewMaze(page);

    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/trpc/maze.saveDraft") && r.status() === 200,
    );
    await page.locator('[data-cell="3,3"]').click();
    await saved;

    await page.reload();
    await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");
  });

  test("the list shows a saved labyrinth and can delete it after confirming", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    await page.goto("/en/labyrinths");

    await expect(page.getByRole("link", { name: "Test maze" })).toBeVisible();
    await page.getByRole("button", { name: "Delete Test maze" }).click();

    // The first click only arms a confirmation step -- the labyrinth must
    // still be there, and a one-click delete must not have fired.
    await expect(page.getByRole("link", { name: "Test maze" })).toBeVisible();
    const confirm = page.getByRole("button", {
      name: "Confirm delete Test maze",
    });
    await expect(confirm).toBeVisible();

    await confirm.click();
    await expect(page.getByRole("link", { name: "Test maze" })).toHaveCount(0);
  });

  test("cancelling the delete confirmation leaves the labyrinth alone", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    await page.goto("/en/labyrinths");

    await page.getByRole("button", { name: "Delete Test maze" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("link", { name: "Test maze" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete Test maze" }),
    ).toBeVisible();
  });
});

test.describe("recovering from a failed save", () => {
  test("shows the translated save-error banner with Retry, and clears it once the save succeeds", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);

    // Fails the first saveDraft call only, then lets every later one through
    // -- this exercises the real network path (autosave, then Retry) rather
    // than a hand-built tRPC response envelope.
    let failNext = true;
    await page.route("**/api/trpc/maze.saveDraft*", async (route) => {
      if (failNext) {
        failNext = false;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.locator('[data-cell="0,0"]').click();

    const banner = page.locator("[data-save-error]");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Your changes could not be saved.");
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();

    await retry.click();
    await expect(banner).toHaveCount(0);
  });
});

test.describe("leaving the editor", () => {
  test("an empty new labyrinth is discarded on the way out", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    const discarded = page.waitForResponse(
      (r) =>
        r.url().includes("/api/trpc/maze.discardIfEmpty") && r.status() === 200,
    );
    await page.getByRole("link", { name: "Labyrinths" }).click();
    await expect(page).toHaveURL(/\/en\/labyrinths$/);
    await discarded;

    // From the server, not a cached list from before the maze existed.
    await page.reload();
    await expect(page.getByRole("link", { name: "Test maze" })).toHaveCount(0);
    await expect(
      page.getByText("You have not drawn any labyrinths yet."),
    ).toBeVisible();
  });

  test("one drawn square, left before the autosave fires, is kept", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    let discards = 0;
    page.on("request", (r) => {
      if (r.url().includes("maze.discardIfEmpty")) discards += 1;
    });
    await page.locator('[data-cell="3,3"]').click();
    // The editor flushes on its way out, rather than losing the square to
    // the autosave debounce.
    const flushed = page.waitForResponse(
      (r) => r.url().includes("/api/trpc/maze.saveDraft") && r.status() === 200,
    );
    await page.getByRole("link", { name: "Labyrinths" }).click();
    await expect(page).toHaveURL(/\/en\/labyrinths$/);
    await flushed;
    // The batch link streams, so the 200 above can arrive before the write
    // commits; the list refetch follows the save's settled body.
    await page.waitForResponse((r) => r.url().includes("/api/trpc/maze.list"));
    expect(discards).toBe(0);

    // Opened again by its link, without a reload: the editor shows what the
    // server holds, not the page as it was when the author left it.

    await page.getByRole("link", { name: "Test maze" }).click();
    await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");
  });

  test("a labyrinth erased back to nothing is discarded on the way out", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/trpc/maze.saveDraft") && r.status() === 200,
    );
    await page.locator('[data-cell="3,3"]').click();
    await saved;

    await page.getByRole("radio", { name: "Erase square" }).click();
    await page.locator('[data-cell="3,3"]').click();
    const discarded = page.waitForResponse(
      (r) =>
        r.url().includes("/api/trpc/maze.discardIfEmpty") && r.status() === 200,
    );
    await page.getByRole("link", { name: "Labyrinths" }).click();
    await expect(page).toHaveURL(/\/en\/labyrinths$/);
    await discarded;

    await page.reload();
    await expect(page.getByRole("link", { name: "Test maze" })).toHaveCount(0);
  });
});

test.describe("a stale copy of the editor", () => {
  /** Resolves once a save has answered 200. */
  function saved(page: Page) {
    return page.waitForResponse(
      (r) => r.url().includes("/api/trpc/maze.saveDraft") && r.status() === 200,
    );
  }

  test("going Back to the editor shows the saved draft, and the next save keeps it", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    const first = saved(page);
    await page.locator('[data-cell="0,0"]').click();
    await first;
    await expect(page.locator("[data-save-state]")).toHaveAttribute(
      "data-save-state",
      "saved",
    );

    await page.getByRole("link", { name: "Labyrinths" }).click();
    await expect(page).toHaveURL(/\/en\/labyrinths$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/en\/labyrinths\/[^/]+$/);

    // The router may hand back the page as first rendered; the editor
    // refreshes itself on open.
    await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");
    const second = saved(page);
    await page.locator('[data-cell="1,0"]').click();
    await second;
    await expect(page.locator("[data-save-state]")).toHaveAttribute(
      "data-save-state",
      "saved",
    );

    await page.reload();
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");
  });

  test("going Back while the flush on the way out is still in flight is not a conflict", async ({
    page,
  }) => {
    await signUpAndOpenNewMaze(page);
    const first = saved(page);
    await page.locator('[data-cell="0,0"]').click();
    await first;
    await expect(page.locator("[data-save-state]")).toHaveAttribute(
      "data-save-state",
      "saved",
    );

    // Every save from here waits, before it reaches the server, until
    // released: the flush on the way out is in flight across the Back.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/trpc/maze.saveDraft*", async (route) => {
      await held;
      await route.continue();
    });

    await page.locator('[data-cell="1,0"]').click();
    await page.getByRole("link", { name: "Labyrinths" }).click();
    await expect(page).toHaveURL(/\/en\/labyrinths$/);
    await page.goBack();
    await expect(page.locator("svg[data-board]")).toBeVisible();
    // Long enough for an ungated refresh to have read the pre-flush draft.
    await page.waitForTimeout(500);
    release();

    // The refresh waited for the flush, so it adopts both squares.
    await expect(page.locator("[data-budget]")).toHaveText("2 / 36 squares");
    await page.locator('[data-cell="2,0"]').click();
    await expect(page.locator("[data-save-state]")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    await expect(page.locator("[data-save-error]")).toHaveCount(0);

    await page.reload();
    await expect(page.locator("[data-budget]")).toHaveText("3 / 36 squares");
  });

  test("a second tab that saves over newer work is refused, and the first tab's work survives", async ({
    page,
    browser,
  }) => {
    await signUpAndOpenNewMaze(page);
    const url = page.url();

    const other = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    try {
      const second = await other.newPage();
      // Opened, and refreshed on open, before the first tab saves anything.
      const fetched = second.waitForResponse((r) =>
        r.url().includes("/api/trpc/maze.get"),
      );
      await second.goto(url);
      await expect(second.locator("svg[data-board]")).toBeVisible();
      await fetched;

      const first = saved(page);
      await page.locator('[data-cell="0,0"]').click();
      await first;

      // The batch link streams, so a refusal still arrives as a 200; the
      // banner is the signal.
      await second.locator('[data-cell="5,5"]').click();
      const banner = second.locator("[data-save-error]");
      await expect(banner).toContainText(
        "This labyrinth was changed somewhere else. Reload to see the latest version.",
      );
      // Locked: no retry of the refused draft, no more edits.
      await expect(second.getByRole("button", { name: "Retry" })).toHaveCount(
        0,
      );
      await expect(second.getByRole("button", { name: "Undo" })).toBeDisabled();

      await second.getByRole("button", { name: "Reload" }).click();
      await expect(second.locator("[data-budget]")).toHaveText(
        "1 / 36 squares",
      );
      await expect(second.locator("[data-save-error]")).toHaveCount(0);

      await page.reload();
      await expect(page.locator("[data-budget]")).toHaveText("1 / 36 squares");
      await expect(page.locator('[data-cell="0,0"]')).toHaveAttribute(
        "aria-label",
        /painted/,
      );
    } finally {
      await other.close();
    }
  });
});

test.describe("the labyrinths list", () => {
  test("shows each labyrinth as a tile with its preview", async ({ page }) => {
    await signUpAndOpenNewMaze(page);
    await page.locator('[data-cell="0,0"]').click();
    await page.locator('[data-cell="1,0"]').click();
    await page.locator('[data-cell="2,0"]').click();
    await expect(page.locator("[data-save-state]")).toHaveAttribute(
      "data-save-state",
      "saved",
    );

    await page.goto("/en/labyrinths");
    const tile = page.locator("[data-maze-item]");
    await expect(tile).toHaveCount(1);
    // A draft with no start or treasure yet still previews its squares, and
    // the shape's outline.
    const preview = tile.locator("svg[data-maze-preview]");
    await expect(preview).toHaveAttribute("aria-hidden", "true");
    await expect(preview.locator("rect")).toHaveCount(3);
    await expect(preview.locator("[data-outline]")).toHaveCount(8);

    // Name above the preview, and both open the labyrinth.
    const name = await tile
      .getByRole("link", { name: "Test maze" })
      .boundingBox();
    const thumb = await preview.boundingBox();
    expect(name!.y + name!.height).toBeLessThanOrEqual(thumb!.y + 1);
    await expect(
      tile.getByRole("button", { name: "Delete Test maze" }),
    ).toBeVisible();
  });
});
