import { expect, test } from "@playwright/test";

import { expectSignedIn, signOut } from "./support/menu";

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
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();

    await expectSignedIn(page);

    await signOut(page);
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    await page.goto("/en/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expectSignedIn(page);
  });

  test("sign-up states the password rule and refuses a short password", async ({
    page,
  }) => {
    await page.goto("/en/sign-up");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAccessibleDescription(
      "At least 10 characters.",
    );

    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(uniqueEmail());
    await password.fill("too-short");
    await page.getByRole("button", { name: "Sign up" }).click();

    // Our own message, not the browser's validation bubble, and nothing sent.
    await expect(page.locator("[data-password-error]")).toHaveText(
      "Password must be at least 10 characters.",
    );
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/en\/sign-up$/);
    await expect(page.locator("[data-menu][data-signed-in]")).toHaveCount(0);
  });

  test("sign-in refuses a short password before sending it", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/auth/sign-in")) requests.push(r.url());
    });
    await page.goto("/sk/sign-in");
    await page.getByLabel("E-mail").fill(uniqueEmail());
    await page.getByLabel("Heslo", { exact: true }).fill("kratke");
    await page.getByRole("button", { name: "Prihlásiť sa" }).click();

    await expect(page.locator("[data-password-error]")).toHaveText(
      "Heslo musí mať aspoň 10 znakov.",
    );
    expect(requests).toEqual([]);
  });

  test("the eye button shows and hides the password", async ({ page }) => {
    await page.goto("/en/sign-in");
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("correct-horse-battery");
    await expect(password).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("correct-horse-battery");

    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("a wrong password shows a translated error", async ({ page }) => {
    const email = uniqueEmail();

    await page.goto("/en/sign-up");
    await page.getByLabel("Name").fill("Test Person");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await signOut(page);
    // Wait for the sign-out to land. The (auth) layout now bounces a
    // signed-in visitor to the home page, so navigating while the session
    // cookie is still alive never reaches the form.
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    await page.goto("/sk/sign-in");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo", { exact: true }).fill("definitely-not-it");
    await page.getByRole("button", { name: "Prihlásiť sa" }).click();

    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Nesprávny e-mail alebo heslo.",
    );
  });
});
