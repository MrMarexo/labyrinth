import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";
import {
  GATED_MAZE_CELL_COUNT,
  GATED_MAZE_GATE_COUNT,
  gatedMazeDraft,
  openMazeDraft,
} from "~/lib/open-maze";
import { CELL_COUNT_PRESETS, validateMaze } from "~/maze";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { maze } from "~/server/db/schema";
import { servingLoopback } from "~/server/env-guards";

/**
 * Callers that predate the `layout` field send none, and mean the open seed.
 * zod's discriminated union does not default its discriminator, so the
 * default is filled in before the union sees the input.
 */
const withDefaultLayout = (input: unknown) =>
  typeof input === "object" && input !== null && !("layout" in input)
    ? { ...input, layout: "open" }
    : input;

/**
 * Three independent conditions, the same shape as `E2E_DISABLE_RATE_LIMIT`'s
 * guard in `~/server/auth`: the flag is explicitly set, we are not on
 * Vercel (platform-injected, not attacker-controlled), and the configured
 * base URL is loopback (`~/server/env-guards`, shared with that other
 * guard so the two definitions cannot drift apart). The third condition is
 * what a Vercel-only check would miss: on any non-Vercel host — self-hosted,
 * Docker, a staging box — `VERCEL` is never set, so a flag mistakenly
 * copied from an e2e `.env` would otherwise leave this reachable there too.
 */
const ENABLED =
  env.E2E_TEST_SUPPORT === "true" && !process.env.VERCEL && servingLoopback;

// Module-level, so it fires once per server process when the flag is on —
// `next start` (what Playwright and any real deployment run) loads this
// module once. `next build`'s static-generation step logs it twice, once
// per worker process it spawns to prerender pages; that is an artifact of
// the build's worker pool, not a second boot, and is expected.
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
      z.preprocess(
        withDefaultLayout,
        z.discriminatedUnion("layout", [
          // The open seed: no walls, no gates, no keys, at any preset size.
          z.object({
            layout: z.literal("open"),
            name: z.string().trim().min(1).max(80),
            cellCount: z
              .number()
              .int()
              .refine(
                (n): n is (typeof CELL_COUNT_PRESETS)[number] =>
                  (CELL_COUNT_PRESETS as readonly number[]).includes(n),
                { message: "maze.format.cellCountNotAPreset" },
              ),
            gateCount: z.literal(0),
          }),
          // The gated seed exists at one size only: a generator that placed
          // gates at every size is speculative work nothing has asked for. A
          // caller sending any other size or gate count gets zod's default
          // "invalid literal" message, which falls through to the generic
          // `errors.validation.invalid` key (see `~/lib/issues`) — this
          // procedure is test-only, so a precise message buys nothing.
          z.object({
            layout: z.literal("gated"),
            name: z.string().trim().min(1).max(80),
            cellCount: z.literal(GATED_MAZE_CELL_COUNT),
            gateCount: z.literal(GATED_MAZE_GATE_COUNT),
          }),
        ]),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();

      const data =
        input.layout === "gated"
          ? gatedMazeDraft()
          : openMazeDraft(input.cellCount);
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
          // `saveDraft` only ever sets these once `validateMaze` passes —
          // and `match.eligibleMazes` filters on `contentHash` being set
          // (a half-drawn draft has none) to keep the picker from ever
          // offering a maze `submitMaze` would reject. This seed already
          // validated above, so it must carry the same two columns a real
          // save would, or every e2e spec that seeds a maze and then picks
          // it in the lobby sees an empty picker.
          contentHash: validation.contentHash,
          optimalMoves: validation.optimalMoves,
        })
        .returning({ id: maze.id });

      return { id: row!.id };
    }),
});
