import { TRPCError } from "@trpc/server";

/**
 * tRPC rejects with a `TRPCError`. A bare `rejects.toThrow()` would also
 * pass on a connection failure, so match the code the procedure actually
 * threw.
 */
export async function rejection(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (!(error instanceof TRPCError)) throw error;
    return { code: error.code, message: error.message };
  }
  throw new Error("expected the call to reject, but it resolved");
}
