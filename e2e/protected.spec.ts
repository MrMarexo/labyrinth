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
