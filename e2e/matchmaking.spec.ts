import { expect, request as apiRequestFactory } from "@playwright/test";

import { PASSWORD, signUpViaApi } from "./support/auth";
import { createMatch, joinMatch, test } from "./support/match";

const SIZE = { cellCount: 36, gateCount: 0 };
// A change reaches the other player over the realtime channel, not a reload.
const PUSH = { timeout: 15_000 };

test.describe("the lobby", () => {
  test("an open match appears for others without a reload, and joining starts drawing", async ({
    players,
  }) => {
    const host = await players({ name: "Host maze", ...SIZE });
    const guest = await players({ name: "Guest maze", ...SIZE });

    await guest.goto("/en/matches");
    const matchId = await createMatch(host, { cells: 36, gates: 0 });

    const entry = guest.locator(`[data-lobby-match="${matchId}"]`);
    await expect(entry).toBeVisible(PUSH);
    await entry.locator("[data-request-state]").click();

    await expect(guest).toHaveURL(new RegExp(`/en/matches/${matchId}$`));
    await expect(guest.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
    );
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
      PUSH,
    );
  });

  test("a second create while waiting shows the already-waiting note", async ({
    players,
  }) => {
    const host = await players({ name: "Host maze", ...SIZE });
    const matchId = await createMatch(host, { cells: 36, gates: 0 });

    await host.goto("/en/matches");
    const note = host.locator("[data-already-waiting]");
    await expect(note).toBeVisible();
    await expect(
      host.getByRole("button", { name: "Create match" }),
    ).toHaveCount(0);
    await note.getByRole("link", { name: "Go to your waiting match" }).click();
    await expect(host).toHaveURL(new RegExp(`/en/matches/${matchId}$`));
  });
});

test.describe("one match at a time", () => {
  test("the match in progress sits on top, and nothing new can be started or joined", async ({
    players,
  }) => {
    const host = await players({ name: "Host maze", ...SIZE });
    const guest = await players({ name: "Guest maze", ...SIZE });
    const other = await players({ name: "Other maze", ...SIZE });
    const matchId = await createMatch(host, { cells: 36, gates: 0 });
    await joinMatch(guest, matchId);
    const elsewhere = await createMatch(other, { cells: 36, gates: 0 });

    await guest.goto("/en/matches");
    const current = guest.locator("[data-current-match]");
    await expect(current).toHaveAttribute("data-current-match", matchId);
    await expect(current).toContainText("Your current match");
    await expect(current).toContainText("Both drawing");
    // Still in the list too, first.
    await expect(guest.locator("[data-match-row]").first()).toHaveAttribute(
      "data-active",
      "",
    );

    await expect(guest.locator("[data-already-active]")).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Create match" }),
    ).toHaveCount(0);
    await expect(guest.locator("[data-lobby-blocked]")).toBeVisible();
    await expect(
      guest.locator(`[data-lobby-match="${elsewhere}"] [data-request-state]`),
    ).toBeDisabled();

    await current.getByRole("link", { name: "Continue" }).click();
    await expect(guest).toHaveURL(new RegExp(`/en/matches/${matchId}$`));
  });
});

test.describe("a locked match", () => {
  test("a request is accepted live and takes the guest into the match", async ({
    players,
  }) => {
    const host = await players({ name: "Host maze", ...SIZE });
    const guest = await players({ name: "Guest maze", ...SIZE });
    const matchId = await createMatch(host, {
      cells: 36,
      gates: 0,
      access: "locked",
    });

    await guest.goto("/en/matches");
    const entry = guest.locator(`[data-lobby-match="${matchId}"]`);
    await expect(entry.locator("[data-locked]")).toBeVisible();
    await entry.getByRole("button", { name: "Request to join" }).click();
    await expect(entry.locator("[data-request-state]")).toHaveAttribute(
      "data-request-state",
      "pending",
    );

    const request = host.locator("[data-join-request]");
    await expect(request).toHaveCount(1, PUSH);
    await request.getByRole("button", { name: /^Accept / }).click();

    await expect(guest).toHaveURL(new RegExp(`/en/matches/${matchId}$`), PUSH);
    await expect(guest.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
    );
    await expect(host.locator("[data-match-status]")).toHaveAttribute(
      "data-match-status",
      "drawing",
      PUSH,
    );
  });

  test("a declined request leaves the guest's button disabled as Declined", async ({
    players,
  }) => {
    const host = await players({ name: "Host maze", ...SIZE });
    const guest = await players({ name: "Guest maze", ...SIZE });
    const matchId = await createMatch(host, {
      cells: 36,
      gates: 0,
      access: "locked",
    });

    await guest.goto(`/en/matches/${matchId}/join`);
    await guest.getByRole("button", { name: "Request to join" }).click();
    await expect(guest.getByRole("button", { name: "Withdraw" })).toBeVisible();

    const request = host.locator("[data-join-request]");
    await expect(request).toHaveCount(1, PUSH);
    await request.getByRole("button", { name: /^Decline / }).click();
    await expect(request).toHaveCount(0);

    const button = guest.locator("[data-request-state]");
    await expect(button).toHaveText("Declined", PUSH);
    await expect(button).toBeDisabled();
  });

  test("a guest can withdraw a request", async ({ players }) => {
    const host = await players({ name: "Host maze", ...SIZE });
    const guest = await players({ name: "Guest maze", ...SIZE });
    const matchId = await createMatch(host, {
      cells: 36,
      gates: 0,
      access: "locked",
    });

    await guest.goto(`/en/matches/${matchId}/join`);
    await guest.getByRole("button", { name: "Request to join" }).click();
    await expect(host.locator("[data-join-request]")).toHaveCount(1, PUSH);

    await guest.getByRole("button", { name: "Withdraw" }).click();
    await expect(
      guest.getByRole("button", { name: "Request to join" }),
    ).toBeVisible();
    await expect(host.locator("[data-join-request]")).toHaveCount(0, PUSH);
  });

  test("a requester's row disappears live when the match is cancelled", async ({
    players,
  }) => {
    const host = await players({ name: "Host maze", ...SIZE });
    const guest = await players({ name: "Guest maze", ...SIZE });
    const matchId = await createMatch(host, {
      cells: 36,
      gates: 0,
      access: "locked",
    });

    await guest.goto("/en/matches");
    const entry = guest.locator(`[data-lobby-match="${matchId}"]`);
    await entry.getByRole("button", { name: "Request to join" }).click();
    await expect(entry.locator("[data-request-state]")).toHaveAttribute(
      "data-request-state",
      "pending",
    );

    await host.locator("[data-cancel-match]").click();
    await host.getByRole("button", { name: "Yes, cancel it" }).click();

    await expect(entry).toHaveCount(0, PUSH);
    await guest.goto(`/en/matches/${matchId}/join`);
    await expect(guest.locator("[data-match-closed]")).toBeVisible();
  });

  test("a requester's row disappears live when someone else fills the match", async ({
    players,
  }) => {
    const host = await players({ name: "Host maze", ...SIZE });
    const guestA = await players({ name: "A maze", ...SIZE });
    const guestB = await players({ name: "B maze", ...SIZE });
    const matchId = await createMatch(host, {
      cells: 36,
      gates: 0,
      access: "locked",
    });

    await guestA.goto("/en/matches");
    const entry = guestA.locator(`[data-lobby-match="${matchId}"]`);
    await entry.getByRole("button", { name: "Request to join" }).click();
    await expect(entry.locator("[data-request-state]")).toHaveAttribute(
      "data-request-state",
      "pending",
    );
    await guestB.goto(`/en/matches/${matchId}/join`);
    await guestB.getByRole("button", { name: "Request to join" }).click();

    const requests = host.locator("[data-join-request]");
    await expect(requests).toHaveCount(2, PUSH);
    // Both accounts share a display name; B asked second, so B's row is last.
    await requests
      .last()
      .getByRole("button", { name: /^Accept / })
      .click();

    await expect(guestB).toHaveURL(new RegExp(`/en/matches/${matchId}$`), PUSH);
    await expect(entry).toHaveCount(0, PUSH);
    await guestA.goto(`/en/matches/${matchId}/join`);
    await expect(guestA.locator("[data-match-closed]")).toBeVisible();
  });
});

test.describe("the share link", () => {
  test("signed out, it shows the preview, and sign-in lands back on it", async ({
    players,
    browser,
    baseURL,
  }) => {
    const host = await players({ name: "Host maze", ...SIZE });
    const matchId = await createMatch(host, {
      cells: 36,
      gates: 0,
      access: "locked",
    });

    const account = await apiRequestFactory.newContext({ baseURL });
    const { email } = await signUpViaApi(account);
    await account.dispose();

    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await page.goto(`/en/matches/${matchId}/join`);
      await expect(
        page.getByRole("button", { name: "Request as guest" }),
      ).toBeVisible();
      await page
        .getByRole("main")
        .getByRole("link", { name: "Sign in", exact: true })
        .click();
      await expect(page).toHaveURL(/\/en\/sign-in\?next=/);
      expect(decodeURIComponent(new URL(page.url()).search)).toContain(
        `next=/matches/${matchId}/join`,
      );

      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();

      await expect(page).toHaveURL(new RegExp(`/en/matches/${matchId}/join$`));
      await expect(
        page.getByRole("button", { name: "Request to join" }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("the creator opening their own link is sent to the match", async ({
    players,
  }) => {
    const host = await players({ name: "Host maze", ...SIZE });
    const matchId = await createMatch(host, {
      cells: 36,
      gates: 0,
      access: "locked",
    });

    await host.goto(`/en/matches/${matchId}/join`);
    await expect(host).toHaveURL(new RegExp(`/en/matches/${matchId}$`));
  });

  test("without navigator.share, the button copies the join URL", async ({
    players,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "clipboard permissions are Chromium-only",
    );
    const host = await players({ name: "Host maze", ...SIZE });
    await host
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await host.context().addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined });
    });
    const matchId = await createMatch(host, {
      cells: 36,
      gates: 0,
      access: "locked",
    });

    await host.locator("[data-share-match]").click();
    await expect(host.getByText("Link copied")).toBeVisible();
    const copied = await host.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(
      `${new URL(host.url()).origin}/en/matches/${matchId}/join`,
    );
  });
});
