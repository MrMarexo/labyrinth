import { describe, expect, it } from "vitest";

import { auth } from "~/server/auth";

function uniqueEmail() {
  return `test-${crypto.randomUUID()}@example.test`;
}

describe("email and password authentication", () => {
  it("registers a user and issues a session", async () => {
    const email = uniqueEmail();

    const result = await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery", name: "Test Person" },
      asResponse: true,
    });

    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toContain("better-auth");
  });

  it("rejects a password below the minimum length", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: uniqueEmail(), password: "short", name: "Test Person" },
      }),
    ).rejects.toThrow();
  });

  it("rejects a wrong password for an existing account", async () => {
    const email = uniqueEmail();
    await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery", name: "Test Person" },
    });

    await expect(
      auth.api.signInEmail({
        body: { email, password: "wrong-password-here" },
      }),
    ).rejects.toThrow();
  });

  it("leaves a new user's locale unset until they choose one", async () => {
    // No defaultValue on the `locale` additional field: a fresh sign-up must
    // be distinguishable from someone who has actually chosen a language,
    // or the app cannot tell "never chosen" apart from "chose English".
    const email = uniqueEmail();
    const signUp = await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery", name: "Test Person" },
    });

    expect((signUp.user as { locale?: string | null }).locale).toBeNull();
  });
});
