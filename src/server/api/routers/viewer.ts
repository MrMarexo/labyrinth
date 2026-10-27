import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export type Viewer =
  { kind: "visitor" } | { kind: "guest"; number: string } | { kind: "member" };

export const viewerRouter = createTRPCRouter({
  get: publicProcedure.query(({ ctx }): Viewer => {
    const user = ctx.session?.user;
    if (!user) return { kind: "visitor" };
    if (user.isAnonymous) return { kind: "guest", number: user.name };
    return { kind: "member" };
  }),
});
