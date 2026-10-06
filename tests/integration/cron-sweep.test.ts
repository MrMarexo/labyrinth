import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

/**
 * `~/env` validates `process.env` once, at import time, into a frozen
 * object — so each scenario here needs its own fresh module graph, loaded
 * after `process.env.CRON_SECRET` is set for that scenario. `vi.resetModules`
 * plus a fresh dynamic import is what makes that possible.
 */
async function freshRoute() {
  vi.resetModules();
  return import("~/app/api/cron/sweep/route");
}

describe("GET /api/cron/sweep", () => {
  it("refuses every request when no secret is configured", async () => {
    delete process.env.CRON_SECRET;

    const { GET } = await freshRoute();
    const response = await GET(new Request("http://localhost/api/cron/sweep"));

    expect(response.status).toBe(404);
  });

  it("refuses a request with the wrong bearer token", async () => {
    process.env.CRON_SECRET = "a".repeat(32);

    const { GET } = await freshRoute();
    const response = await GET(
      new Request("http://localhost/api/cron/sweep", {
        headers: { authorization: "Bearer wrong" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("runs the sweep and reports its result when the bearer token matches", async () => {
    const secret = "b".repeat(32);
    process.env.CRON_SECRET = secret;

    const { GET } = await freshRoute();
    const response = await GET(
      new Request("http://localhost/api/cron/sweep", {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { closed: number; capped: boolean };
    expect(typeof body.closed).toBe("number");
    expect(typeof body.capped).toBe("boolean");
  });
});
