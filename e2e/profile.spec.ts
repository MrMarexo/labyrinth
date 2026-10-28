import { expect, test } from "@playwright/test";

import { PASSWORD, signIntoContext } from "./support/auth";
import { openMenu, signOut } from "./support/menu";

test.describe("the menu", () => {
  test("holds profile and sign-out, and the nav links only on a phone, set apart", async ({
    page,
    request,
    baseURL,
    isMobile,
  }) => {
    await signIntoContext(page.context(), request, baseURL!);
    await page.goto("/en");

    const headerNav = page.locator("[data-header-nav]");
    await openMenu(page);
    const panel = page.locator("[data-menu-panel]");
    const panelNav = panel.locator("[data-menu-nav]");

    if (isMobile) {
      await expect(headerNav).toBeHidden();
      await expect(
        panelNav.getByRole("link", { name: "Matches", exact: true }),
      ).toBeVisible();
      await expect(
        panelNav.getByRole("link", { name: "Labyrinths", exact: true }),
      ).toBeVisible();
      // A rule sets them apart from the settings below.
      await expect(panel.getByRole("separator").first()).toBeVisible();
    } else {
      await expect(headerNav).toBeVisible();
      await expect(panelNav).toBeHidden();
    }
    await expect(
      panel.getByRole("radiogroup", { name: "Language" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("radiogroup", { name: "Theme" }),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: "Sign out" })).toBeVisible();

    await panel.getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/en\/profile$/);
    await expect(panel).toBeHidden();
  });

  test("an anonymous visitor's menu has settings but no profile or sign-out", async ({
    page,
  }) => {
    await page.goto("/en");
    await openMenu(page);
    const panel = page.locator("[data-menu-panel]");
    await expect(
      panel.getByRole("radiogroup", { name: "Theme" }),
    ).toBeVisible();
    await expect(panel.getByRole("link", { name: "Profile" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Sign out" })).toHaveCount(
      0,
    );
  });
});

test.describe("the profile page", () => {
  test("shows the email and renames the player", async ({
    page,
    request,
    baseURL,
  }) => {
    const email = await signIntoContext(page.context(), request, baseURL!);
    const profile = page;
    await profile.goto("/en/profile");

    await expect(profile.locator("[data-profile-email]")).toHaveText(email);
    const name = profile.getByLabel("Name");
    await expect(name).toHaveValue("Test Person");

    await name.fill("Renamed Player");
    await profile.getByRole("button", { name: "Save name" }).click();
    await expect(profile.locator("[data-name-status]")).toHaveText("Saved.");

    await profile.reload();
    await expect(profile.getByLabel("Name")).toHaveValue("Renamed Player");
  });

  test("changes the password, refusing a wrong current one", async ({
    page,
    request,
    baseURL,
  }) => {
    const email = await signIntoContext(page.context(), request, baseURL!);
    const profile = page;
    await profile.goto("/en/profile");

    const current = profile.getByLabel("Current password");
    const next = profile.getByLabel("New password");
    const submit = profile.getByRole("button", { name: "Change password" });

    await current.fill("not-the-password");
    await next.fill("a-brand-new-password");
    await submit.click();
    await expect(profile.locator("[data-password-status]")).toHaveText(
      "Your current password is not right.",
    );

    await current.fill(PASSWORD);
    await next.fill("short");
    await submit.click();
    await expect(profile.locator("[data-password-status]")).toHaveText(
      "Password must be at least 10 characters.",
    );

    await next.fill("a-brand-new-password");
    await submit.click();
    await expect(profile.locator("[data-password-status]")).toHaveText(
      "Password changed.",
    );

    await signOut(profile);
    await expect(
      profile.getByRole("banner").getByRole("link", { name: "Sign in" }),
    ).toBeVisible();
    // The header outlives the navigation; the menu must not stay open.
    await expect(profile.locator("[data-menu-panel]")).toBeHidden();
    await profile.goto("/en/sign-in");
    await profile.getByLabel("Email").fill(email);
    await profile
      .getByLabel("Password", { exact: true })
      .fill("a-brand-new-password");
    await profile.getByRole("button", { name: "Sign in" }).click();
    await expect(profile).toHaveURL(/\/en$/);
  });
});
