import { expect, test } from "@playwright/test";

const PASSWORD = "correct-horse-battery";

function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

test.describe("protected area", () => {
  test("redirects an anonymous visitor to sign in", async ({ page }) => {
    await page.goto("/en/play");
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  });

  test("lets a signed-in person in, and remembers their language", async ({
    page,
  }) => {
    await page.goto("/en/sign-up");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    // The session cookie lands asynchronously; wait for it before navigating,
    // or /en/play races the sign-up and the (app) layout redirects to
    // sign-in, which also has an <h1> and a Language combobox, so a generic
    // assertion below would pass on the wrong page.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.goto("/en/play");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your games" }),
    ).toBeVisible();

    await page.getByRole("combobox", { name: "Language" }).selectOption("sk");
    await expect(page).toHaveURL(/\/sk\/play$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Vaše hry" }),
    ).toBeVisible();

    // A fresh visit to the unprefixed root should land on the stored locale.
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
    await page.getByLabel("Heslo").fill(PASSWORD);
    await page.getByRole("button", { name: "Registrovať sa" }).click();

    await expect(
      page.getByRole("button", { name: "Odhlásiť sa" }),
    ).toBeVisible();
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
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.getByRole("combobox", { name: "Language" }).selectOption("sk");
    await expect(page).toHaveURL(/\/sk$/);

    await page.getByRole("button", { name: "Odhlásiť sa" }).click();
    await expect(
      page.getByRole("link", { name: "Prihlásiť sa" }),
    ).toBeVisible();

    // Clear every cookie, including NEXT_LOCALE, so the only way the
    // upcoming sign-in can land on Slovak is by reading the account's
    // stored preference from the database.
    await context.clearCookies();

    await page.goto("/en/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/sk$/);
  });
});
