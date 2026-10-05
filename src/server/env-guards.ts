import { env } from "~/env";

/**
 * Whether this server is configured for a loopback origin — `localhost` or
 * `127.0.0.1` — rather than a real host. True for local dev and for
 * Playwright, which always targets `127.0.0.1`.
 *
 * Shared by every env-flag guard that must not survive a copy-paste into a
 * deployed environment: `BETTER_AUTH_URL` is fixed per deployment (Vercel
 * production, a self-hosted box, a staging server), so a flag that also
 * requires this can never go live just because `VERCEL` happens to be
 * unset — which is the gap a Vercel-only check leaves on every other host.
 * One definition, imported everywhere a guard needs it, so the predicate
 * cannot drift between the two places that check it.
 */
export const servingLoopback =
  env.BETTER_AUTH_URL !== undefined &&
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(env.BETTER_AUTH_URL);
