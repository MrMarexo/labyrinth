import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
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
    command: "pnpm build && E2E_DISABLE_RATE_LIMIT=true pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
