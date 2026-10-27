import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins";
import { randomInt } from "node:crypto";
import { cache } from "react";

import { env } from "~/env";
import { MIN_PASSWORD_LENGTH } from "~/lib/password";
import { db } from "~/server/db";
import { servingLoopback } from "~/server/env-guards";

// The rate limiter may only be switched off for a local end-to-end run.
// Three independent conditions must all hold: the flag is explicitly set,
// we are not on Vercel (platform-injected, not attacker-controlled), and
// the configured base URL is loopback (see `~/server/env-guards`). A
// deployed host fails the third even if someone copies the flag into its
// environment.
const disableRateLimit =
  env.E2E_DISABLE_RATE_LIMIT === "true" &&
  !process.env.VERCEL &&
  servingLoopback;

if (disableRateLimit) {
  console.warn(
    "[auth] Rate limiting is DISABLED via E2E_DISABLE_RATE_LIMIT. This must only ever happen in a local end-to-end test run.",
  );
}

export const auth = betterAuth({
  // Omitted when unset: preview deployments get a different hostname on
  // every deploy, so Better Auth infers the origin from the incoming
  // request instead of a fixed value.
  ...(env.BETTER_AUTH_URL ? { baseURL: env.BETTER_AUTH_URL } : {}),
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  // The dynamic origin inference above resolves to Next's own bound
  // hostname, not the alias a client actually connected through — so
  // "localhost" and "127.0.0.1" need trusting explicitly for local dev and
  // Playwright (which targets 127.0.0.1). Not trusted on Vercel, which has
  // no loopback traffic and gets its own deployment URLs trusted instead.
  trustedOrigins: [
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    ...(process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
      : []),
    ...(process.env.VERCEL
      ? []
      : ["http://localhost:3000", "http://127.0.0.1:3000"]),
  ],
  // Better Auth's rate limiter caps /sign-up and /sign-in at 3 requests per
  // 10s per IP. Playwright's desktop and mobile projects share a loopback
  // address and trip it. See `disableRateLimit` above for the guard.
  rateLimit: {
    ...(disableRateLimit ? { enabled: false } : {}),
    customRules: { "/sign-in/anonymous": { window: 60, max: 20 } },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    // A signed copy of the session in a cookie, so a request (every move)
    // skips the session query. A revoked session lives on in it for up to
    // maxAge; nothing reads more than `session.user.id` from it.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  // Writes the cache cookie that `getSession` refreshes back onto the
  // response; without it the cache would lapse five minutes after sign-in.
  // Must stay the last plugin.
  plugins: [
    anonymous({
      generateName: () => String(1000 + randomInt(9000)),
      disableDeleteAnonymousUser: true,
    }),
    nextCookies(),
  ],
  user: {
    additionalFields: {
      locale: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;

/**
 * The only way anything should read the session on the server.
 *
 * A protected page render asks three times — the site header, the (app) or
 * (auth) layout, and the tRPC context — and each ask is a real database
 * query. This collapses them into one per request.
 *
 * The cache is keyed on the cookie header rather than on the `Headers`
 * object, because the three callers do not all hold the same instance:
 * `src/trpc/server.ts` clones the request headers so it can stamp
 * `x-trpc-source`, and a clone would miss an identity-keyed cache. Whoever
 * asks first still hands Better Auth its own full `Headers`.
 *
 * `cache()` only spans one request, and outside a React request (the
 * integration tests, for instance) it has no store and simply calls
 * through — so this degrades to an uncached call rather than leaking a
 * session between requests.
 */
const sessionCache = cache(
  () => new Map<string, ReturnType<typeof auth.api.getSession>>(),
);

export function getSession(headers: Headers) {
  const perRequest = sessionCache();
  const key = headers.get("cookie") ?? "";

  let pending = perRequest.get(key);
  if (!pending) {
    pending = auth.api.getSession({ headers });
    perRequest.set(key, pending);
  }

  return pending;
}
