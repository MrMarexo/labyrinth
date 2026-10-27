import { describe, expect, it } from "vitest";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

import { guestSignedIn, signedIn } from "./players";

describe("guest identity", () => {
  it("guest sign-in makes an anonymous user with a four-digit name", async () => {
    const ctx = await guestSignedIn();

    expect(ctx.session?.user.isAnonymous).toBe(true);
    expect(ctx.session?.user.name).toMatch(/^[1-9]\d{3}$/);
  });

  it("viewer.get tells a visitor, a guest and a member apart", async () => {
    const visitor = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    expect(await visitor.viewer.get()).toEqual({ kind: "visitor" });

    const guestCtx = await guestSignedIn();
    expect(await createCaller(guestCtx).viewer.get()).toEqual({
      kind: "guest",
      number: guestCtx.session!.user.name,
    });

    expect(await createCaller(await signedIn()).viewer.get()).toEqual({
      kind: "member",
    });
  });
});
