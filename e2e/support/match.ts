import {
  expect,
  request as apiRequestFactory,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { signedInContext } from "./auth";

type PlayerOptions = {
  name: string;
  cellCount: number;
  gateCount: number;
  layout?: "open" | "gated";
};

/**
 * Seeds a valid labyrinth owned by whoever `page` is signed in as, member or
 * guest, through the app's own session so the maze belongs to them.
 */
export async function seedMaze(
  page: Page,
  options: PlayerOptions,
): Promise<void> {
  await page.goto("/en/matches");
  const seeded = await page.evaluate<unknown, typeof options>(async (input) => {
    const response = await fetch("/api/trpc/testSupport.seedMaze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    });
    if (!response.ok) throw new Error(`seed failed: ${response.status}`);
    return (await response.json()) as unknown;
  }, options);
  expect(seeded).toBeTruthy();
}

/**
 * A signed-in page with a valid labyrinth already seeded at the given size.
 *
 * The maze is seeded through `testSupport.seedMaze` rather than drawn,
 * per spec §12 — a test that clicks seventy-two cells is a test that fails
 * for reasons unrelated to the match lifecycle it is checking.
 *
 * The request below is a direct (non-batched) tRPC call: no `?batch=1`
 * query param, and a body of exactly `{ json: <input> }`. That shape was
 * read off `resolveResponse`'s `jsonContentTypeHandler.parse` in
 * `@trpc/server` (not guessed): when `batch` isn't `"1"`, the handler does
 * `inputs = await req.json()` and then
 * `transformer.input.deserialize(inputs)` directly — no per-call index
 * wrapper, unlike the batched envelope `httpBatchStreamLink` sends from the
 * real app. `src/server/api/trpc.ts` configures that transformer as
 * `superjson`, matching `src/trpc/react.tsx`'s client, and superjson's
 * encoding of a plain object with no special types (dates, maps, ...) is
 * just `{ json: <value> }`. So a bare `fetch` with that body is both
 * simpler than replicating the batch link and exactly what the route
 * handler at `src/app/api/trpc/[trpc]/route.ts` accepts.
 *
 * Deliberately does not take the test's shared `request` fixture (unlike
 * the brief's sample, which threaded it straight through to
 * `signedInContext`): that fixture is one `APIRequestContext` — one cookie
 * jar — for the whole test. Every test here seats two players, and
 * Better Auth's origin-check middleware
 * (`better-auth/dist/api/middlewares/origin-check.mjs`) only validates the
 * `Origin` header once a `Cookie` header is present on the request. The
 * first sign-up through the shared fixture has no cookie yet, so it skips
 * the check and succeeds; the second one now carries the first player's
 * session cookie, trips the check, and gets "Missing or null Origin" —
 * confirmed by reproducing it. A fresh, disposable `APIRequestContext`
 * per player sidesteps this and is the more honest fixture anyway: two
 * real people would never share one.
 */
async function playerWithMaze(
  browser: Browser,
  baseURL: string,
  options: PlayerOptions,
): Promise<Page> {
  const signUpRequest = await apiRequestFactory.newContext({ baseURL });
  const context = await signedInContext(browser, signUpRequest, baseURL);
  await signUpRequest.dispose();
  const page = await context.newPage();

  await seedMaze(page, options);

  return page;
}

/**
 * `test`, extended with a `players` fixture that owns every browser context
 * a spec opens through it and closes all of them in its teardown.
 *
 * A context from `browser.newContext()` (which `playerWithMaze` creates,
 * via `signedInContext`) is not a fixture Playwright owns — closing it is
 * the test's job. A plain `context.close()` written at the end of a test
 * body only runs when the body reaches that line; an assertion that throws
 * partway through skips it, leaking the context for the rest of the
 * worker's lifetime. That is exactly the run (a failing, re-run, bisected
 * spec) where the leak is most expensive, since it is also the run whose
 * output someone is about to read closely.
 *
 * A fixture's teardown — the code after `await provideFixture(...)` — runs
 * whether the test body returns normally or throws, the same guarantee a
 * `try/finally` gives a single test, but centralised once here instead of
 * copied into every spec. (The callback is named `provideFixture`, not
 * Playwright's usual `use`: an identifier starting with `use` reads as a
 * React hook to `eslint-plugin-react-hooks`, which this repo's config
 * applies project-wide, and it is not one — Playwright calls it
 * positionally, so any name works.)
 */
export const test = base.extend<{
  players: (options: PlayerOptions) => Promise<Page>;
}>({
  players: async ({ browser, baseURL }, provideFixture) => {
    const contexts: BrowserContext[] = [];
    await provideFixture(async (options) => {
      const page = await playerWithMaze(browser, baseURL!, options);
      contexts.push(page.context());
      return page;
    });
    // `allSettled`, not `all`: closing must never throw over an assertion
    // that already failed inside the test body — that assertion's error is
    // the one worth seeing — and one context failing to close must not stop
    // the rest from closing.
    await Promise.allSettled(contexts.map((c) => c.close()));
  },
});

/** Creates a match from the matches page and returns its id, read off the URL. */
export async function createMatch(
  page: Page,
  options: { cells: number; gates: number; access?: "open" | "locked" },
): Promise<string> {
  await page.goto("/en/matches");
  await page.getByRole("radio", { name: `${options.cells} squares` }).click();
  await page
    .getByRole("radiogroup", { name: "Gates" })
    .getByRole("radio", { name: String(options.gates), exact: true })
    .click();
  if (options.access === "locked") {
    await page.getByRole("radio", { name: /^Locked/ }).click();
  }
  await page.getByRole("button", { name: "Create match" }).click();
  await expect(page).toHaveURL(/\/en\/matches\/[^/]+$/);
  return page.url().split("/").at(-1)!;
}

/** Opens a match's join page as `guest`, joins, and waits to be seated. */
export async function joinMatch(guest: Page, matchId: string): Promise<void> {
  await guest.goto(`/en/matches/${matchId}/join`);
  await guest.getByRole("button", { name: "Join", exact: true }).click();
  await expect(guest).toHaveURL(new RegExp(`/en/matches/${matchId}$`));
}

/**
 * Opens a match's join page as a visitor, joins as a guest, and waits to be
 * seated. The visitor's first join signs them in anonymously.
 */
export async function joinAsGuest(
  visitor: Page,
  matchId: string,
): Promise<void> {
  await visitor.goto(`/en/matches/${matchId}/join`);
  // Reads "Join" once the visitor already is a guest.
  await visitor.getByRole("button", { name: /^Join( as guest)?$/ }).click();
  await expect(visitor).toHaveURL(new RegExp(`/en/matches/${matchId}$`));
}
