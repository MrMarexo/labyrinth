import { eq } from "drizzle-orm";
import { z } from "zod";

import { locales } from "~/i18n/routing";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { user } from "~/server/db/schema";

export const profileRouter = createTRPCRouter({
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
