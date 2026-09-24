import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { env } from "~/env";
import { db } from "~/server/db";

export const auth = betterAuth({
  // Omitted when unset: preview deployments get a different hostname on
  // every deploy, so Better Auth infers the origin from the incoming
  // request instead of a fixed value.
  ...(env.BETTER_AUTH_URL ? { baseURL: env.BETTER_AUTH_URL } : {}),
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  // The dynamic origin inference above resolves to Next's own bound
  // hostname, not the alias a client actually connected through — so
  // "localhost" and "127.0.0.1" need trusting explicitly for local dev
  // and Playwright (which targets 127.0.0.1) to both work.
  trustedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  // Better Auth's production rate limiter caps /sign-up and /sign-in at 3
  // requests per 10s per IP. Playwright's desktop and mobile projects both
  // hit those routes from the same loopback address, so the e2e webServer
  // (see playwright.config.ts) sets TEST=1 to turn it off for that run only.
  ...(process.env.TEST === "1" ? { rateLimit: { enabled: false } } : {}),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      locale: {
        type: "string",
        defaultValue: "en",
        required: false,
        input: false,
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
