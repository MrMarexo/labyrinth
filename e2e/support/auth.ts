import type {
  APIRequestContext,
  Browser,
  BrowserContext,
} from "@playwright/test";

export const PASSWORD = "correct-horse-battery";

export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

/**
 * Spec §12: authentication is seeded through the API, not by driving the
 * form — except in the one spec whose subject *is* the form. Driving it
 * fourteen times a run is why the rate limiter had to be disabled for e2e
 * in the first place.
 */
export async function signUpViaApi(
  request: APIRequestContext,
  email = uniqueEmail(),
): Promise<{ email: string; password: string; cookies: string[] }> {
  const response = await request.post("/api/auth/sign-up/email", {
    data: { email, password: PASSWORD, name: "Test Person" },
  });
  if (!response.ok()) {
    throw new Error(
      `sign-up via API failed: ${response.status()} ${await response.text()}`,
    );
  }
  return {
    email,
    password: PASSWORD,
    cookies: response
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value),
  };
}

/** A fresh browser context already signed in as a brand-new account. */
export async function signedInContext(
  browser: Browser,
  request: APIRequestContext,
  baseURL: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  await signIntoContext(context, request, baseURL);
  return context;
}

/**
 * Signs an existing context in as a brand-new account and returns its email.
 * For the test's own `page`, whose context keeps the project's device — a
 * phone viewport on mobile — where `signedInContext` starts a bare one.
 */
export async function signIntoContext(
  context: BrowserContext,
  request: APIRequestContext,
  baseURL: string,
): Promise<string> {
  const { email, cookies } = await signUpViaApi(request);
  const { hostname } = new URL(baseURL);
  await context.addCookies(
    cookies.map((raw) => {
      const [pair] = raw.split(";");
      const [name, ...rest] = pair!.split("=");
      return {
        name: name!.trim(),
        value: rest.join("=").trim(),
        domain: hostname,
        path: "/",
      };
    }),
  );
  return email;
}
