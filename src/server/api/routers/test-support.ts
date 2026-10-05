import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";
import { openMazeDraft } from "~/lib/open-maze";
import { CELL_COUNT_PRESETS, MAX_GATES, validateMaze } from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { maze } from "~/server/db/schema";

/**
 * Two independent conditions, because one of them is a string in an
 * environment file and the other is not. Vercel sets `VERCEL` on every
 * deployment, so even a misconfigured production env cannot open this.
 */
const ENABLED = env.E2E_TEST_SUPPORT === "true" && !process.env.VERCEL;

if (env.E2E_TEST_SUPPORT === "true") {
  console.warn(
    "[test-support] E2E_TEST_SUPPORT is on. Seeding procedures are exposed. " +
      `Reachable: ${ENABLED}. The only correct value outside a local e2e run is "false".`,
  );
}

function assertEnabled() {
  if (!ENABLED) {
    throw new TRPCError({ code: "NOT_FOUND", message: "errors.unknown" });
  }
}

export const testSupportRouter = createTRPCRouter({
  /**
   * A valid, already-drawn labyrinth owned by the caller, so a spec can get
   * to the part it is testing. Seeds the shape only — it does not submit,
   * because which match a maze belongs to is exactly what the specs are
   * for.
   */
  seedMaze: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        cellCount: z
          .number()
          .int()
          .refine(
            (n): n is (typeof CELL_COUNT_PRESETS)[number] =>
              (CELL_COUNT_PRESETS as readonly number[]).includes(n),
            { message: "maze.format.cellCountNotAPreset" },
          ),
        gateCount: z.number().int().min(0).max(MAX_GATES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();

      const data = openMazeDraft(input.cellCount);
      const validation = validateMaze(data, {
        cellCount: input.cellCount,
        gateCount: input.gateCount,
      });
      if (!validation.ok) {
        // The generator produced something the validator rejects. That is a
        // bug in the seed, not in the caller, and a silent bad fixture is
        // worse than a loud failure.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "errors.mazeInvalid",
        });
      }

      const [row] = await ctx.db
        .insert(maze)
        .values({
          authorId: ctx.session.user.id,
          name: input.name,
          cellCount: input.cellCount,
          gateCount: input.gateCount,
          data,
        })
        .returning({ id: maze.id });

      return { id: row!.id };
    }),
});
