import { expect, test } from "@playwright/test";

import { PASSWORD, uniqueEmail } from "./support/auth";
import { expectSignedIn, openMenu, signOut } from "./support/menu";

test.describe("protected area", () => {
  test("redirects an anonymous visitor to sign in", async ({ page }) => {
    await page.goto("/en/play");
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  });

  test("shows a visitor the matches and labyrinths pages, with a sign-up notice", async ({
    page,
  }) => {
    await page.goto("/en/matches");
    await expect(page).toHaveURL(/\/en\/matches$/);
    await expect(page.locator('[data-sign-up-notice="matches"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();

    await page.goto("/en/labyrinths");
    await expect(page).toHaveURL(/\/en\/labyrinths$/);
    const notice = page.locator('[data-sign-up-notice="labyrinths"]');
    await expect(notice).toBeVisible();
    await notice.getByRole("link", { name: "Sign up" }).click();
    await expect(page).toHaveURL(/\/en\/sign-up\?next=%2Flabyrinths$/);
  });

  test("lets a signed-in person in, and remembers their language", async ({
    page,
  }) => {
    await page.goto("/en/sign-up");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    // The session cookie lands asynchronously; wait for it before navigating,
    // or /en/play races the sign-up and the (app) layout redirects to
    // sign-in, which also has an <h1> and a Language picker, so a generic
    // assertion below would pass on the wrong page.
    await expectSignedIn(page);

    await page.goto("/en/play");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your games" }),
    ).toBeVisible();

    await openMenu(page);
    await page
      .getByRole("radiogroup", { name: "Language" })
      .getByRole("radio", { name: "Slovenčina" })
      .click();
    await expect(page).toHaveURL(/\/sk\/play$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Vaše hry" }),
    ).toBeVisible();

    // Cookies are intact here, so this only proves the NEXT_LOCALE cookie
    // the switch wrote — not the preference stored on the account. The
    // database path is proved by the last test in this file.
    await page.goto("/");
    await expect(page).toHaveURL(/\/sk$/);
  });
});

test.describe("language preference", () => {
  test("keeps a Slovak sign-up in Slovak", async ({ page }) => {
    // A new user's stored locale defaults to null (never chosen). Signing
    // up in Slovak must not be misread as "chose English" and bounce them.
    await page.goto("/sk/sign-up");
    await page.getByLabel("Meno").fill("Test Person");
    await page.getByLabel("E-mail").fill(uniqueEmail());
    await page.getByLabel("Heslo", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Registrovať sa" }).click();

    await expectSignedIn(page);
    await expect(page).toHaveURL(/\/sk$/);
  });

  test("a Slovak sign-up alone is enough to be remembered", async ({
    page,
    context,
  }) => {
    // The third leg of the feature: sign-up writes the current locale
    // fire-and-forget, with no switcher involved. Its failure would only
    // ever surface on a second device, so prove it the same way — by
    // throwing the cookies away.
    const email = uniqueEmail();

    const localeSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/trpc/profile.setLocale") &&
        response.status() === 200,
    );

    await page.goto("/sk/sign-up");
    await page.getByLabel("Meno").fill("Test Person");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Registrovať sa" }).click();

    await expectSignedIn(page);
    await localeSaved;

    await signOut(page, "Odhlásiť sa");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Prihlásiť sa" }),
    ).toBeVisible();

    await context.clearCookies();

    await page.goto("/en/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/sk$/);
  });

  test("a stored preference travels with the account, not just the cookie", async ({
    page,
    context,
  }) => {
    const email = uniqueEmail();

    await page.goto("/en/sign-up");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expectSignedIn(page);

    await openMenu(page);
    await page
      .getByRole("radiogroup", { name: "Language" })
      .getByRole("radio", { name: "Slovenčina" })
      .click();
    await expect(page).toHaveURL(/\/sk$/);

    await signOut(page, "Odhlásiť sa");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Prihlásiť sa" }),
    ).toBeVisible();

    // Clear every cookie, including NEXT_LOCALE, so the only way the
    // upcoming sign-in can land on Slovak is by reading the account's
    // stored preference from the database.
    await context.clearCookies();

    await page.goto("/en/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/sk$/);
  });
});
