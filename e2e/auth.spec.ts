import { expect, test } from "@playwright/test";

function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

const PASSWORD = "correct-horse-battery";

test.describe("authentication", () => {
  test("a person can register, sign out, and sign back in", async ({
    page,
  }) => {
    const email = uniqueEmail();

    await page.goto("/en/sign-up");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    await page.goto("/en/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("a wrong password shows a translated error", async ({ page }) => {
    const email = uniqueEmail();

    await page.goto("/en/sign-up");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();

    await page.goto("/sk/sign-in");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo").fill("definitely-not-it");
    await page.getByRole("button", { name: "Prihlásiť sa" }).click();

    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Nesprávny e-mail alebo heslo.",
    );
  });
});
