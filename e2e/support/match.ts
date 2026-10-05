import {
  expect,
  request as apiRequestFactory,
  type Browser,
  type Page,
} from "@playwright/test";

import { signedInContext } from "./auth";

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
export async function playerWithMaze(
  browser: Browser,
  baseURL: string,
  options: { name: string; cellCount: number; gateCount: number },
): Promise<Page> {
  const signUpRequest = await apiRequestFactory.newContext({ baseURL });
  const context = await signedInContext(browser, signUpRequest, baseURL);
  await signUpRequest.dispose();
  const page = await context.newPage();

  // Seed through the app's own session so the maze belongs to this player.
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

  return page;
}

/** Reads the join code off the matches page after creating a match. */
export async function createMatch(
  page: Page,
  options: { cells: number; gates: number },
): Promise<string> {
  await page.goto("/en/matches");
  await page.getByRole("radio", { name: `${options.cells} squares` }).click();
  await page.getByLabel("Gates").fill(String(options.gates));
  await page.getByRole("button", { name: "Create match" }).click();
  await expect(page).toHaveURL(/\/en\/matches\/[^/]+$/);
  // The code is the attribute's value, not something sliced out of the
  // rendered sentence — `matches.shareCode` puts the code mid-sentence in
  // Slovak, so `innerText().slice(-6)` only happens to work in English.
  const code = await page
    .locator("[data-match-code]")
    .getAttribute("data-match-code");
  expect(code).toBeTruthy();
  return code!;
}
