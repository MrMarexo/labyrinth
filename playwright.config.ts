import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // "github" alone only writes inline annotations — it never produces
  // playwright-report/, which the workflow then uploads as nothing.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    // E2E_DISABLE_RATE_LIMIT=true turns off Better Auth's rate limiter:
    // desktop and mobile projects both hit /sign-up and /sign-in from
    // 127.0.0.1, which trips its default 3-requests-per-10s-per-IP cap.
    // See src/server/auth — this flag is ignored (rate limiting stays on)
    // whenever VERCEL is set or the base URL isn't loopback.
    command: "pnpm build && pnpm start",
    // Set here rather than inherited from .env: BETTER_AUTH_URL is optional
    // there, and without a loopback value the guard in src/server/auth keeps
    // rate limiting on and the run fails confusingly.
    env: { BETTER_AUTH_URL: baseURL, E2E_DISABLE_RATE_LIMIT: "true" },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
