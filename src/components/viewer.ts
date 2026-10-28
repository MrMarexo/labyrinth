"use client";

import { api } from "~/trpc/react";

/** Who is looking: a visitor (no session), a guest, or a member. */
export function useViewer() {
  const { data, isPending } = api.viewer.get.useQuery();
  return { viewer: data, isPending };
}
