import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { locales } from "~/i18n/routing";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/db/schema";

export const profileRouter = createTRPCRouter({
  // Read from the table, not the session: the session's cookie cache can
  // hold a name changed in the last few minutes.
  get: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, ctx.session.user.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    return row;
  }),

  setName: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(user)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(user.id, ctx.session.user.id));

      return { name: input.name };
    }),

  setLocale: protectedProcedure
    .input(z.object({ locale: z.enum(locales) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(user)
        .set({ locale: input.locale })
        .where(eq(user.id, ctx.session.user.id));

      return { locale: input.locale };
    }),
});
