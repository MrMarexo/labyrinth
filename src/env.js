import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().url(),
    DATABASE_URL_UNPOOLED: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    // Fixed on Vercel production, but preview deployments get a different
    // hostname on every deploy — there is no single correct value there.
    // Left unset, Better Auth infers the origin from the incoming request.
    BETTER_AUTH_URL: z.string().url().optional(),
    // Playwright-only: lets the e2e webServer turn off Better Auth's
    // production rate limiter, which a full desktop+mobile run trips from a
    // shared loopback IP. Guarded again at the call site by `!process.env.VERCEL`.
    E2E_DISABLE_RATE_LIMIT: z.enum(["true", "false"]).default("false"),
    // Playwright-only: exposes `testSupport.seedMaze`, which writes real
    // maze rows as the caller. Guarded again at the call site by
    // `!process.env.VERCEL`, and the router logs a warning at boot if it is
    // ever on, because the only correct value outside a local e2e run is
    // "false".
    E2E_TEST_SUPPORT: z.enum(["true", "false"]).default("false"),
    // Vercel Cron sends this as a bearer token. Optional so a local `pnpm
    // dev` does not demand it; the route refuses every request when it is
    // unset, which is the right default for a secret.
    CRON_SECRET: z.string().min(32).optional(),
    // Spec §8.1. All four or none: without them the server publishes to the
    // in-process bus, which only reaches browsers on the same Node process
    // (local dev, `next start`, the e2e suite). A deployment without them
    // still works — clients fall back to polling.
    PUSHER_APP_ID: z.string().optional(),
    PUSHER_KEY: z.string().optional(),
    PUSHER_SECRET: z.string().optional(),
    PUSHER_CLUSTER: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // The public half of the Pusher config. Set both, or the client uses the
    // local event stream.
    NEXT_PUBLIC_PUSHER_KEY: z.string().optional(),
    NEXT_PUBLIC_PUSHER_CLUSTER: z.string().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    E2E_DISABLE_RATE_LIMIT: process.env.E2E_DISABLE_RATE_LIMIT,
    E2E_TEST_SUPPORT: process.env.E2E_TEST_SUPPORT,
    CRON_SECRET: process.env.CRON_SECRET,
    PUSHER_APP_ID: process.env.PUSHER_APP_ID,
    PUSHER_KEY: process.env.PUSHER_KEY,
    PUSHER_SECRET: process.env.PUSHER_SECRET,
    PUSHER_CLUSTER: process.env.PUSHER_CLUSTER,
    NEXT_PUBLIC_PUSHER_KEY: process.env.NEXT_PUBLIC_PUSHER_KEY,
    NEXT_PUBLIC_PUSHER_CLUSTER: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    NODE_ENV: process.env.NODE_ENV,
    // NEXT_PUBLIC_CLIENTVAR: process.env.NEXT_PUBLIC_CLIENTVAR,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
