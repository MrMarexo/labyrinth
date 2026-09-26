import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";

import { auth } from "~/server/auth";

function uniqueEmail() {
  return `test-${crypto.randomUUID()}@example.test`;
}

/**
 * Better Auth rejects with an `APIError`. A bare `rejects.toThrow()` would
 * also pass on a connection failure, so every rejection below is matched on
 * the code and status it actually carries.
 */
async function rejection(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (!(error instanceof APIError)) throw error;
    const body = error.body as { code?: string; message?: string } | undefined;
    return { code: body?.code, status: error.statusCode };
  }
  throw new Error("expected the call to reject, but it resolved");
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

  // The three codes below are the three string literals in the switch in
  // src/components/auth-form.tsx. Nothing else pins them: Better Auth can
  // rename one in a minor release and the only symptom in the UI is the
  // generic "something went wrong" fallback. INVALID_EMAIL_OR_PASSWORD is
  // also pinned end-to-end by the Slovak assertion in e2e/auth.spec.ts.

  it("rejects a password below the minimum length", async () => {
    // Unreachable from the form, which sets minLength={10} on the input —
    // but minPasswordLength on the server is the actual rule, and this is
    // the code the form would have to translate if anything ever posted
    // around the browser's constraint.
    await expect(
      rejection(
        auth.api.signUpEmail({
          body: {
            email: uniqueEmail(),
            password: "short",
            name: "Test Person",
          },
        }),
      ),
    ).resolves.toEqual({ code: "PASSWORD_TOO_SHORT", status: 400 });
  });

  it("rejects a second sign-up with the same email", async () => {
    const email = uniqueEmail();
    await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery", name: "Test Person" },
    });

    await expect(
      rejection(
        auth.api.signUpEmail({
          body: {
            email,
            password: "correct-horse-battery",
            name: "Test Person",
          },
        }),
      ),
    ).resolves.toEqual({
      code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
      status: 422,
    });
  });

  it("rejects a wrong password for an existing account", async () => {
    const email = uniqueEmail();
    await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery", name: "Test Person" },
    });

    await expect(
      rejection(
        auth.api.signInEmail({
          body: { email, password: "wrong-password-here" },
        }),
      ),
    ).resolves.toEqual({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 });
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
