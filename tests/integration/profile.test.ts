import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { db } from "~/server/db";
import { user } from "~/server/db/schema";
import { auth } from "~/server/auth";

/**
 * tRPC rejects with a `TRPCError`. A bare `rejects.toThrow()` would also
 * pass on a connection failure, so match the code the procedure actually
 * threw.
 */
async function rejection(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (!(error instanceof TRPCError)) throw error;
    return { code: error.code, message: error.message };
  }
  throw new Error("expected the call to reject, but it resolved");
}

async function signedInContext() {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test Person" },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return createTRPCContext({ headers: new Headers({ cookie }) });
}

describe("profile.setLocale", () => {
  it("stores a supported locale on the user", async () => {
    const ctx = await signedInContext();
    const caller = createCaller(ctx);

    await caller.profile.setLocale({ locale: "sk" });

    const [row] = await db
      .select()
      .from(user)
      .where(eq(user.id, ctx.session!.user.id));

    expect(row?.locale).toBe("sk");
  });

  it("rejects an unsupported locale", async () => {
    const ctx = await signedInContext();
    const caller = createCaller(ctx);

    await expect(
      rejection(caller.profile.setLocale({ locale: "de" as "en" })),
    ).resolves.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses an anonymous caller with a message key", async () => {
    const ctx = await createTRPCContext({ headers: new Headers() });
    const caller = createCaller(ctx);

    await expect(
      rejection(caller.profile.setLocale({ locale: "sk" })),
    ).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "errors.notSignedIn",
    });
  });
});
